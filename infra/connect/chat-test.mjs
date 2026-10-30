// Drives a REAL Amazon Connect chat on the burger-chat flow from the terminal (costs Connect chat/AI usage),
// then prints the adapter's log lines for that contact (tool, ok, state, errorCode per call).
// Usage: node infra/connect/chat-test.mjs [--cartRef <ref>] "turn 1" "turn 2" ...
import { CloudWatchLogsClient, FilterLogEventsCommand } from "@aws-sdk/client-cloudwatch-logs";
import { ConnectClient, ListContactFlowsCommand, StartChatContactCommand } from "@aws-sdk/client-connect";
import { ConnectParticipantClient, CreateParticipantConnectionCommand, DisconnectParticipantCommand, GetTranscriptCommand, SendMessageCommand } from "@aws-sdk/client-connectparticipant";
import { FLOW, INSTANCE_ID, LAMBDA, REGION } from "../deploy/config.mjs";

const args = process.argv.slice(2);
let cartRef;
if (args[0] === "--cartRef") [, cartRef] = args.splice(0, 2);
const turns = args;
const connect = new ConnectClient({ region: REGION });
const participant = new ConnectParticipantClient({ region: REGION });
const logs = new CloudWatchLogsClient({ region: REGION });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const flows = (await connect.send(new ListContactFlowsCommand({ InstanceId: INSTANCE_ID, ContactFlowTypes: ["CONTACT_FLOW"] }))).ContactFlowSummaryList;
const flowName = process.env.FLOW_NAME ?? FLOW;
const flowId = flows.find((f) => f.Name === flowName)?.Id;
if (!flowId) throw new Error(`Flow ${FLOW} not found`);

const started = Date.now();
const start = await connect.send(new StartChatContactCommand({
  InstanceId: INSTANCE_ID, ContactFlowId: flowId, ParticipantDetails: { DisplayName: "CLI tester" },
  ...(cartRef ? { Attributes: { cartRef } } : {}),
}));
const contactId = start.ContactId;
console.log(`contactId ${contactId}${cartRef ? " (with cartRef)" : ""}`);
const conn = await participant.send(new CreateParticipantConnectionCommand({ ParticipantToken: start.ParticipantToken, Type: ["WEBSOCKET", "CONNECTION_CREDENTIALS"] }));
const ConnectionToken = conn.ConnectionCredentials.ConnectionToken;

// Join the chat the way the widget does: open the participant websocket and subscribe to aws/chat.
// Without this the customer never counts as connected and the flow does not run.
const ws = new WebSocket(conn.Websocket.Url);
await new Promise((resolve, reject) => {
  ws.onopen = () => {
    ws.send(JSON.stringify({ topic: "aws/subscribe", content: { topics: ["aws/chat"] } }));
    resolve();
  };
  ws.onerror = (e) => reject(new Error(`websocket error ${e.message ?? ""}`));
});
const heartbeat = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ topic: "aws/heartbeat" })), 10_000);

const seen = new Set();
let lastNew = 0;
let aiMessages = 0;
let ended = false;
async function poll() {
  let t;
  try {
    t = await participant.send(new GetTranscriptCommand({ ConnectionToken, MaxResults: 100, SortOrder: "ASCENDING" }));
  } catch (e) {
    // Once the chat ends (e.g. the AI closes it after an order), the connection token is revoked.
    if (e.name !== "AccessDeniedException") throw e;
    ended = true;
    return;
  }
  for (const m of t.Transcript ?? []) {
    if (seen.has(m.Id)) continue;
    seen.add(m.Id);
    lastNew = Date.now();
    if (m.Type === "MESSAGE" && m.ParticipantRole !== "CUSTOMER") {
      aiMessages++;
      console.log(`AI: ${m.Content}`);
    }
    if (m.Type === "EVENT" && /ended|left/.test(m.ContentType ?? "")) {
      console.log(`[${m.ContentType}]`);
      if (/ended/.test(m.ContentType ?? "")) ended = true;
    }
  }
}
/** Waits for at least one new AI message, then until the chat has been quiet for 5 s (max 90 s). */
async function waitForReply() {
  const t0 = Date.now();
  const before = aiMessages;
  while (Date.now() - t0 < 90_000) {
    await sleep(1500);
    await poll();
    if (ended || (aiMessages > before && Date.now() - lastNew > 5000)) return;
  }
  console.log("(no reply within 90 s)");
}

await waitForReply();
for (const text of turns) {
  if (ended) {
    console.log(`\n(chat ended; skipped ${turns.length - turns.indexOf(text)} remaining turn(s))`);
    break;
  }
  console.log(`\nCUSTOMER: ${text}`);
  await participant.send(new SendMessageCommand({ ConnectionToken, ContentType: "text/plain", Content: text }));
  await waitForReply();
}
await participant.send(new DisconnectParticipantCommand({ ConnectionToken })).catch(() => {});
clearInterval(heartbeat);
ws.close();

await sleep(4000);
const events = await logs.send(new FilterLogEventsCommand({ logGroupName: `/aws/lambda/${LAMBDA}`, startTime: started - 5000, filterPattern: `"${contactId}"` }));
console.log("\nadapter log (orderState per call):");
for (const e of events.events ?? []) {
  try {
    const j = JSON.parse(e.message.slice(e.message.indexOf("{")));
    console.log(`  ${new Date(e.timestamp).toISOString().slice(11, 23)} ${j.msg}${j.tool ? ` ${j.tool}` : ""} ok=${j.ok ?? ""} state=${j.state ?? ""}${j.errorCode ? ` error=${j.errorCode}` : ""}${j.linkedWebCart !== undefined ? ` linkedWebCart=${j.linkedWebCart}` : ""} ${j.ms ?? ""}ms`);
  } catch {
    /* non-JSON lines */
  }
}
