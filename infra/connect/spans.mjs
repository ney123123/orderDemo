// Prints the AI agent's tool calls for one chat contact, from Q Connect trace spans.
// Tool failures show up here (e.g. "MCP client failure …"), not in the flow logs.
// Usage: node infra/connect/spans.mjs <contactId>
import * as Q from "@aws-sdk/client-qconnect";
import { ASSISTANT_ID, REGION } from "../deploy/config.mjs";

const contactId = process.argv[2];
if (!contactId) throw new Error("Usage: node infra/connect/spans.mjs <contactId>");
const q = new Q.QConnectClient({ region: REGION });
const search = await q.send(new Q.SearchSessionsCommand({ assistantId: ASSISTANT_ID, searchExpression: { filters: [{ field: "NAME", operator: "EQUALS", value: contactId }] } }));
const sessionId = search.sessionSummaries?.[0]?.sessionId;
if (!sessionId) throw new Error(`No AI session named ${contactId}`);

const { spans = [] } = await q.send(new Q.ListSpansCommand({ assistantId: ASSISTANT_ID, sessionId }));
const agent = spans.find((s) => s.attributes?.aiAgentName);
console.log("agent:", agent?.attributes.aiAgentName, "v" + agent?.attributes.aiAgentVersion, "| spans:", spans.map((s) => s.spanName).join(","));
for (const s of spans.filter((x) => x.spanName === "execute_tool")) {
  const use = s.attributes.inputMessages?.[0]?.values?.[0]?.toolUse;
  const result = s.attributes.outputMessages?.[0]?.values?.[0]?.toolResult?.values?.[0]?.text?.value ?? "";
  // Arguments can hold the customer's name; print only their keys.
  console.log(s.startTimestamp?.toISOString?.() ?? s.startTimestamp, use?.name, s.status, "args:", Object.keys(JSON.parse(use?.arguments ?? "{}")).join(","), "→", result.replace(/\s+/g, " ").slice(0, 300));
}
