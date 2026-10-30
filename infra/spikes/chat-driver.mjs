// Drives a real Connect chat on a flow: StartChatContact → participant connection → send turns → print transcript.
import { ConnectClient, StartChatContactCommand } from "@aws-sdk/client-connect";
import { ConnectParticipantClient, CreateParticipantConnectionCommand, SendMessageCommand, GetTranscriptCommand, DisconnectParticipantCommand } from "@aws-sdk/client-connectparticipant";
import { INSTANCE_ID } from "../deploy/config.mjs";
const R = "ca-central-1", c = new ConnectClient({ region: R }), p = new ConnectParticipantClient({ region: R });
const [flowId, ...turns] = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const start = await c.send(new StartChatContactCommand({ InstanceId: INSTANCE_ID, ContactFlowId: flowId,
  ParticipantDetails: { DisplayName: "SpikeTester" } }));
console.log("contactId", start.ContactId);
const conn = await p.send(new CreateParticipantConnectionCommand({ ParticipantToken: start.ParticipantToken, Type: ["WEBSOCKET", "CONNECTION_CREDENTIALS"] }));
const ConnectionToken = conn.ConnectionCredentials.ConnectionToken;
const seen = new Set();
const dump = async () => {
  const t = await p.send(new GetTranscriptCommand({ ConnectionToken, MaxResults: 100, SortOrder: "ASCENDING" }));
  for (const m of t.Transcript) if (!seen.has(m.Id)) { seen.add(m.Id);
    if (m.Type === "MESSAGE" || m.Type === "EVENT") console.log(`[${m.ParticipantRole ?? m.Type}] ${m.Content ?? m.ContentType}`); }
};
await sleep(6000); await dump();
for (const text of turns) {
  console.log(`>>> ${text}`);
  await p.send(new SendMessageCommand({ ConnectionToken, ContentType: "text/plain", Content: text }));
  await sleep(15000); await dump();
}
await p.send(new DisconnectParticipantCommand({ ConnectionToken })).catch(() => {});
