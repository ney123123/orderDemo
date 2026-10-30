// Prints the customer/AI conversation of one chat or web call, read from the AI agent's trace spans.
// The instance stores no transcripts (no CHAT_TRANSCRIPTS storage configured), so this is the only copy,
// and it lasts as long as Q Connect keeps the session. The output holds what the customer said, including
// their name: run it on test contacts, and don't paste it into logs or tickets.
// Usage: node infra/connect/transcript.mjs <contactId>
import * as Q from "@aws-sdk/client-qconnect";
import { ASSISTANT_ID, REGION } from "../deploy/config.mjs";

const contactId = process.argv[2];
if (!contactId) throw new Error("Usage: node infra/connect/transcript.mjs <contactId>");
const q = new Q.QConnectClient({ region: REGION });
const search = await q.send(new Q.SearchSessionsCommand({ assistantId: ASSISTANT_ID, searchExpression: { filters: [{ field: "NAME", operator: "EQUALS", value: contactId }] } }));
const sessionId = search.sessionSummaries?.[0]?.sessionId;
if (!sessionId) throw new Error(`No AI session named ${contactId}`);

const { spans = [] } = await q.send(new Q.ListSpansCommand({ assistantId: ASSISTANT_ID, sessionId }));
// Every model call carries the whole conversation so far; the latest one plus its output is the full transcript.
const last = spans.filter((s) => s.spanName === "inference").sort((a, b) => +new Date(a.startTimestamp) - +new Date(b.startTimestamp)).at(-1);
if (!last) throw new Error("No model calls recorded for this contact yet");
const messages = [...(last.attributes.inputMessages ?? []), ...(last.attributes.outputMessages ?? [])];
for (const m of messages) {
  const text = (m.values ?? [])
    .map((v) => v.text?.value)
    .filter(Boolean)
    .join(" ")
    .replace(/<thinking>[\s\S]*?<\/thinking>/g, "")
    .replace(/<\/?message>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  // Skip tool calls and tool results (JSON); only spoken or typed turns.
  if (text && !text.startsWith("{")) console.log(`${m.timestamp ? new Date(m.timestamp).toISOString().slice(11, 19) : ""} ${m.participant === "CUSTOMER" ? "CUSTOMER" : "AI"}: ${text}`);
}
