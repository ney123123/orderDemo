# AWS Feasibility — AI Burger Ordering on Amazon Connect

Status: **Phase 0 in progress.** Docs re-verified 2026-10-29. Spikes A and B **not yet run**.

Legend: ✅ documented & clear · ⚠️ documented but uncertain for our use · ❓ undocumented — must be proven by a spike · ❌ unsupported

---

## 1. Account & environment (observed 2026-10-29)

| Item | Observed |
|---|---|
| AWS CLI | 2.27.27, authenticated as IAM user `nemaWork` (account `<ACCOUNT_ID>`) |
| Default region | `ca-central-1` |
| Existing Connect instances | none in ca-central-1, us-east-1, us-west-2 |
| IAM self-inspection | `iam:ListAttachedUserPolicies` denied — the user's permissions are unknown. Creating a Connect instance or Q Connect domain may fail with AccessDenied; this would only show up when we try. |
| Local | Node 22.22.0, no CDK CLI installed (will use `npx cdk`) |
| Repo | empty directory, not a git repository |
| `connect:CreateInstance`, `qconnect:CreateAssistant`, `connect:CreateIntegrationAssociation` | **allowed** (verified by doing them) |
| `iam:CreateRole` | initially **denied**; the user granted `burger-*` role management (2026-10-29), verified |
| `qconnect:CreateAIAgent` (orchestration) | requires `connectInstanceArn` in `orchestrationAIAgentConfiguration` (otherwise `ValidationException: InstanceArn is missing or null`) |

### Spike resources created (2026-10-29, ca-central-1, tag `project=burger-order-demo`)
| Resource | Id |
|---|---|
| Connect instance `<instance-alias>` | `<INSTANCE_ID>` — ACTIVE, `MESSAGE_STREAMING=true` (verified), inbound calls on, outbound off, no phone number |
| Q Connect assistant `burger-spike-assistant` (type AGENT, capability V2) | `<ASSISTANT_ID>` |
| Integration association (assistant ↔ instance) | `d76741ca-1cbb-4beb-948d-7c555634d511` |
| IAM role `burger-spike-a-lambda` (inline policy `spike-a`: logs, `connect:DescribeContact`, `wisdom:UpdateSessionData` scoped to this instance/assistant) | `arn:aws:iam::<ACCOUNT_ID>:role/burger-spike-a-lambda` |
| Lambda `burger-spike-a-update-session` (nodejs22.x, log retention 7 d), associated with the instance | smoke-tested: loads, returns `NO_CONTACT_CONTEXT` on an empty event |
| AI prompt `burger-spike-a-orchestration` v1 | `284c15e9-0149-4119-abd8-364089cc3104` |
| AI agent `burger-spike-a-agent` (ORCHESTRATION, tools: `Complete`) | `87d12493-b594-4dbb-9bc3-2792cbec220e` |

Observed: the system agents in ca-central-1 include **separate `SelfServiceOrchestratorChat` (`aa71963b-…`) and `SelfServiceOrchestratorVoice` (`201e7719-…`)** orchestration agents, not the single `SelfServiceOrchestrator` named in the docs. Chat will copy the Chat variant, and voice (Spike B) the Voice variant, both with the same tools.

---

## 2. Region choice

Model used by the `SelfServiceOrchestration` system prompt ([create-ai-prompts](https://docs.aws.amazon.com/connect/latest/adminguide/create-ai-prompts.html#cli-create-aiprompt)):

| Region | SelfServiceOrchestration model | Data residency |
|---|---|---|
| us-east-1 / us-west-2 | `us.anthropic.claude-4-5-haiku-20251001-v1:0` (US cross-region) | inference stays in US regions |
| ca-central-1 | `global.anthropic.claude-4-5-haiku-20251001-v1:0` (Global CRIS) | **inference may be processed outside Canada** |

Custom orchestration prompts in ca-central-1 can only choose from: `us.anthropic.claude-4-5-sonnet` (US CRIS), `global.anthropic.claude-4-5-haiku`, `global.anthropic.claude-4-5-sonnet`, `anthropic.claude-3-haiku`. In ca-central-1, no orchestration-capable modern model keeps inference in Canada.

**Recommendation: `us-east-1`** for the demo. It has the widest model list, it is the region the AWS workshops use, and the menu is fictional, so there is no residency requirement. If ca-central-1 is required, record "model inference via Global CRIS" in the README.
**Decision (2026-10-29): `ca-central-1`** (user choice). README must state that orchestrator inference uses `global.anthropic.claude-4-5-haiku` (Global CRIS) and may be processed outside Canada.

---

## 3. Capability checklist

### 3.1 AI agent session data → system prompt ✅ / ❓
- `UpdateSessionData` (Q Connect API) writes key/value pairs to a session, and prompts read them as `{{$.Custom.<KEY>}}`. A missing key renders as an empty string. [ai-agent-session](https://docs.aws.amazon.com/connect/latest/adminguide/ai-agent-session.html)
- The documented pattern: a **Connect assistant** block, then a **Lambda** block in the flow, *before* the conversation. `sessionId` comes from `DescribeContact`, and `assistantId` from the Connect assistant block's domain.
- ❓ **Not documented:** whether an `UpdateSessionData` call made *during* the orchestrator conversation (from inside a tool) is re-rendered into `{{$.Custom.*}}` on the next model call. → **Spike A.**

### 3.2 MCP tools ✅ / ⚠️
[ai-agent-mcp-tools](https://docs.aws.amazon.com/connect/latest/adminguide/ai-agent-mcp-tools.html)
- Three tool sources: out-of-the-box tools, **flow-module tools**, and third-party MCP through **Bedrock AgentCore Gateway**.
- Tool configuration supports extra instructions, **input value overrides**, and output filtering.
- **30-second** timeout per MCP tool call.
- AI agents are governed by **security profiles**. Per a third-party write-up ([Classmethod](https://dev.classmethod.jp/en/articles/amazon-connect-customer-ai-agent-flow-module-lambda-reservation/)), both the AI agent's profile and the profile of the user configuring it need flow-module access.
- Flow-module tool pattern (Classmethod, not AWS docs): module input schema → Lambda block (sync, response validation `STRING_MAP`) → Return block. **Lambda responses must be flat string maps**, so structured results are JSON-serialized into one string field. Interactive blocks (play prompt, get input) can't be used inside tool modules. Tools reference a specific **module version**.
- ⚠️ Not confirmed in AWS docs: whether the Lambda event inside a tool-invoked module carries `Details.ContactData.ContactId`, as a normal flow Lambda invocation does. If it doesn't, we need an input override that maps the contact ID into a module input. → checked in **Spike A** (it decides how the adapter gets `contactId`, `assistantId` and `sessionId`).
- AI prompt tool `input_schema` supports only `type: "string"` (plus `enum`, `default`). So tool inputs must be flat strings/enums, and the adapter parses `quantity` etc. from strings.

**Chosen tool transport (tentative): flow-module tools → Lambda.** Why: no extra service (AgentCore Gateway adds an OAuth-protected gateway and its own cost), and the contact context is native to the flow. The decision is re-checked after Spike A.

### 3.3 Constant tools ✅ (not usable for Spike A as written)
[agentic-self-service](https://docs.aws.amazon.com/connect/latest/adminguide/agentic-self-service.html#agentic-self-service-constant-tools): a Constant tool returns a **configured static string** and executes nothing. It **cannot call `UpdateSessionData`**. The spec's wording "A Constant or Lambda tool calls UpdateSessionData" is therefore corrected: Spike A uses a **flow-module tool → Lambda**.

### 3.4 Orchestrator agent, Return to Control ✅
- Copy `SelfServiceOrchestrator`. It comes with RtC tools `Complete` and `Escalate`; **`Escalate` can be removed** (documented).
- When a RtC tool fires, the AI conversation ends, and the tool name/inputs land in Lex session attributes (`Tool`), checked with **Check contact attributes**.
- Responses **must be wrapped in `<message>` tags**, or the customer sees nothing.
- An assistant-message prefill must be removed for some models (Sonnet 4.6, gpt-oss). Haiku 4.5 keeps the template unchanged.
- Agentic self-service is documented for **voice and chat**.

### 3.5 Chat widget & message streaming ✅
- [setup-agentic-selfservice-end-to-end](https://docs.aws.amazon.com/connect/latest/adminguide/setup-agentic-selfservice-end-to-end.html), [message-streaming-ai-chat](https://docs.aws.amazon.com/connect/latest/adminguide/message-streaming-ai-chat.html)
- Orchestrator agents **require** chat streaming. Instances created after December 2025 have `MESSAGE_STREAMING=true` by default; a new instance would be created now, so this is expected to be on. Check with `aws connect describe-instance-attribute --attribute-type MESSAGE_STREAMING`.
- Streaming timeout is 60 s (standard chat: 10 s).
- Lex bot alias policy needs `lex:RecognizeMessageAsync`. This is added automatically for new bot associations.
- Widget: created in the console (Channels → Communications widget), with **allowed domains** (`http://localhost` for dev).

### 3.6 Passing a signed cart reference from the widget ✅
[pass-contact-attributes-chat](https://docs.aws.amazon.com/connect/latest/adminguide/pass-contact-attributes-chat.html)
- Enable widget **security** to get a security key. The site's server issues an **HS256 JWT** with `sub = widgetId`, `iat`, `exp` and an `attributes` claim (string → string map) through `amazon_connect('authenticate', cb)`.
- Using a JWT "ensures the integrity of the data". Attributes are **encoded, not encrypted** (readable), so we pass an opaque `cartRef`, never PII.
- Token limit: 6144 bytes (~3000 chars).
- The unsigned `amazon_connect('contactAttributes', …)` path is **client-mutable** (keys prefixed `HostedWidget-`), so it is **not used** for the cart reference.
- Design: `cartRef` = random `cartId` (also in the site's httpOnly cookie). The flow reads `$.Attributes.cartRef`, and the adapter Lambda maps `contactId → cartId` into `SESSION#<contactId>` on first use. The JWT secret lives in Secrets Manager.

### 3.7 Web calling → orchestrator agent ⚠️ → Spike B
[inapp-calling](https://docs.aws.amazon.com/connect/latest/adminguide/inapp-calling.html)
- The same Communications Widget supports web/in-app calling; it is enabled per widget.
- The docs talk about routing to agents, and nothing found states that web calling **cannot** reach a Lex/AI-agent flow without a human. Agentic self-service is documented for voice. Whether a browser web call reaches the orchestrator end-to-end with no queue/agent is not shown explicitly. → **Spike B.**
- Voice needs Lex speech plus a voice set in the flow (Set voice block).

### 3.8 IaC coverage ⚠️
- CloudFormation/CDK covers: `AWS::Connect::Instance`, flows and flow modules, security profiles, Lambda associations, Lex v2 bots, and `AWS::Wisdom::*` (assistant, AI agent, AI prompt — **availability of every orchestrator field in CFN to be checked at Phase 3**).
- Expected console-only (from the docs' console steps): Communications Widget creation and security key, setting the default self-service AI agent, the AI-agent intent on a Conversational AI bot, and attaching MCP tools to the AI agent. Each will be recorded in `docs/connect-setup.md` with the reason.

---

## 4. Cost drivers (list prices, [pricing](https://aws.amazon.com/connect/pricing/), [appendix](https://aws.amazon.com/products/connect/customer/pricing/appendix/), checked 2026-10-29; regional rates not broken out)

| Driver | Price |
|---|---|
| Connect chat | $0.010 / message sent or received |
| Connect AI agent, chat | $0.0015 / message |
| Web/in-app calling audio | $0.010 / min |
| Connect voice | $0.038 / min (+ communication charges) |
| Connect AI agent, voice | $0.008 / min (10 s minimum) |
| Lex requests from the Connect instance | included |
| Connect instance, phone number | instance has no fixed fee; **no phone number will be claimed** (not needed for widget chat/web calling) |
| Lambda, DynamoDB on-demand, CloudWatch Logs | free-tier-scale for a demo |
| AgentCore Gateway | not used (avoids cost) |

Rough spike cost: ~40 chat messages × ($0.010 + $0.0015) ≈ **$0.50**, plus a few web-call minutes ≈ **$0.10**. A typical demo order of ~20 messages ≈ $0.25.

---

## 5. Quotas & limits relevant to the design
- MCP tool call: 30 s timeout. Chat streaming turn: 60 s.
- Widget JWT: ≤ 6144 bytes. Contact attributes: string → string.
- Prompt variables: `{{$.Custom.*}}` must come **after** ≥1,000 tokens of static prefix to benefit from prompt caching (caching is on by default).
- Flow-module Lambda response: flat `STRING_MAP` (third-party source).

## 6. Open questions / risks
1. ❓ Mid-conversation `UpdateSessionData` re-render (Spike A). Fallback: `INSTRUCTION_CHANNEL=tool_result`.
2. ⚠️ Contact ID availability inside a tool-invoked module Lambda (Spike A).
3. ⚠️ Web calling → orchestrator with no human agent (Spike B).
4. ✅ (resolved 2026-10-29) `nemaWork` now manages `burger-*` roles, after the user applied `nemawork-iam-grant.json`. Verified by creating `burger-spike-a-lambda`.
5. ⚠️ → likely resolved. Observed in the live system agent config (`infra/connect/reference/SelfServiceOrchestratorChat.agent-config.json`): the built-in `Retrieve` tool uses `overrideInputValues` with `constant.value: "{{$.assistantId}}"`, so **override constants accept template variables**. The system prompt exposes `{{$.contactId}}`, `{{$.instanceId}}`, `{{$.sessionId}}`, `{{$.assistantId}}`, `{{$.dateTime}}`. Plan: override `contactId = {{$.contactId}}`; it is never model-filled. Spike A confirms it works for flow-module tools.
6. Note: the system prompt prints `contactId`/`sessionId` into `<system_variables>`. Our orchestration prompt will **remove that block** (§6 rule 15: never reveal ids), since overrides don't need the model to see them.
7. Observed: in ca-central-1 the system `SelfServiceOrchestrationChat` prompt uses **`us.anthropic.claude-haiku-4-5-20251001-v1:0` (US CRIS)**, and `SelfServiceOrchestrationVoice` uses `global.anthropic.claude-haiku-4-5…` (Global CRIS). The doc table says `global` for both. Chat inference therefore runs in US regions, voice possibly anywhere. Both are outside Canada.
8. The installed AWS CLI 2.27.27 cannot parse orchestration agent configs (`SDK_UNKNOWN_MEMBER`). Scripts use `@aws-sdk/client-qconnect@3.1159.0`. Phase 6 docs must require a current CLI/SDK.

---

## 7. Spike results

| Spike | Result | Evidence | Consequence |
|---|---|---|---|
| A — mid-conversation prompt update | **PASS (2026-10-29)**: A1 mechanism + A2 tool path. In-turn freshness unproven (A3) | see "Spike A results" | **`INSTRUCTION_CHANNEL=both`** (session_data + state block in the tool result) |
| B — web calling → orchestrator | **PENDING** | — | voice entry hidden until passed |

### Spike A results (2026-10-29, ca-central-1, Connect Test chat)

**A1 — Does a mid-conversation `UpdateSessionData` reach the next model call? PASS.**
Session `459df36c-21cb-4fc3-b4c6-19a6cd8f0289`, read back with `qconnect:ListMessages`:

| UTC | Participant | Text |
|---|---|---|
| 05:48:44.651 | CUSTOMER | `hi` |
| 05:48:45.533 | BOT | `[step: STEP-1]` Hi there! Welcome. … |
| 05:48:51.694 | (script) | `UpdateSessionData orderState=STEP-3` |
| 05:48:52.206 | CUSTOMER | `what step are we on?` |
| 05:48:52.981 | BOT | `[step: STEP-3]` We're on step 3. … |

The value changed between two AI turns and was rendered on the **very next** model call (no one-turn delay). An earlier run (session `62d3b5f6…`) also showed that a value written after session start, and before the first AI turn, is picked up. Prompt caching held: `cacheReadInputTokens: 5335` on later turns, with the variable placed after the static prefix.

**A2 — Calling it from inside an MCP flow-module tool: PASS (after two fixes).**
Session `bc304cc4-7511-4e96-8775-810332726e8d` (agent v4, tool → `SpikeAdvanceTool` v2):

| UTC | Event (from `ListSpans` + Lambda log) |
|---|---|
| 06:09:35.512 | inference → `[step: STEP-1]` … then `toolUse SpikeAdvance` |
| 06:09:36.825 | `execute_tool` **OK** → `{"result":"ok"}` |
| 06:09:37.446 | Lambda (identity `source: override:sessionId`) → `UpdateSessionData STEP-2` |
| 06:09:37.610 | inference (same turn, after the tool) → "Great! I've advanced…" (**no step tag**) |
| 06:09:42.166 | next customer turn → `[step: STEP-2]` ✅ |

Root causes found on the way (each verified):
1. **`Failed to start flow module execution`** = CloudTrail `connect:StartFlowModuleExecution` **AccessDenied … explicit deny in a session policy**, called by `AWSServiceRoleForAmazonConnect_*` with the session name = AI agent id. The AI agent's security profile had `AllowedFlowModules` but **no permissions**. Fix: permission **`ContactFlowModules.Execute`** on the agent's profile. Connect caches the role session: denials continued until a session created after the fix (06:07:48).
2. **`Tool output validation failed … Missing required parameters: result`** = the Return block's `ResultData` must be an **object matching the output schema** (`{"result":"$.External.result"}`). The console saves a bare string (`"$.External.result"`) when "Set dynamically" is chosen. This is a console trap; always check the module JSON.
3. API-created and console "Save as tool" modules behave the same (ProbeTool vs SpikeAdvanceTool compared field by field). The console's tool copy dropped `LambdaFunctionARN` and had to be re-selected.

**A3 — Is a tool's update visible to the model's reply in the *same* turn? UNPROVEN.** In run 06:07 the post-tool reply (inference 181 ms after the write) showed `STEP-1`; in run 06:09 the post-tool reply omitted the tag. The next customer turn always showed the new value. **Decision:** return the rendered state block in the tool result as well (`INSTRUCTION_CHANNEL=both`), so the reply right after a tool always has the current step, and `UpdateSessionData` keeps the system prompt current for every later turn. This deviates from the spec's two-value setting; it is the union of both channels, and the domain layer is unchanged.

**Identity findings (needed for Phase 3):**
- A flow-invoked Lambda **receives `Details.ContactData.ContactId`**. `DescribeContact` → `Contact.WisdomInfo.SessionArn` = `arn:aws:wisdom:<region>:<acct>:session/<assistantId>/<sessionId>` (verified; field set by the `SetWisdomAssistant` block).
- Tool overrides `{{$.contactId}}`, `{{$.sessionId}}`, `{{$.assistantId}}` resolve to real values → the model never supplies identity.

**Chat session creation (correction to the docs):** the flow-language action `CreateWisdomSession` creates **no session on chat**, as its reference page says ("voice only"), and Lex then fails with `Amazon Lex needs active session for Q In Connect … x-amz-lex:q-in-connect:session-arn`. The console's current **Connect assistant** block emits `SetWisdomAssistant` (+ `SetContactData WisdomSessionArn`), which works on chat.

**Lex bot role (custom role):** it must trust `lexv2.aws.internal` and allow `wisdom:CreateSession/GetAssistant` on the assistant and `wisdom:SendMessage/GetNextMessage` on its sessions ([AMAZON.QinConnectIntent](https://docs.aws.amazon.com/lexv2/latest/dg/built-in-intent-qinconnect.html)). Without this: `Amazon Lex could not access your Q In Connect Assistant`.

### Phase 3 findings (2026-10-29, real CLI chats on `burger-chat`)

**Result: scenario 1 passes end to end.** Contact `f595d1e3-4e0d-4620-bc61-5ab7a63aa0b9`: addToCart → chooseComboItems → reviewOrder → submitOrder, all `ok=true`; order `PL-HWGJM8` (Sam, $10.00, PENDING) stored in `burger-orders`. One call per tool.

Verified, each by a failing chat and then a passing one:
1. **The AI conversation uses the assistant's default orchestrator** for `Connect.SelfService`, not the agent named in the flow's session block. `deploy.mjs` sets it (`UpdateAssistantAIAgent`, `orchestratorUseCase: "Connect.SelfService"`).
2. **The default must be `<agentId>:$LATEST`** (what the console stores). With a numbered version (`<agentId>:8`) *every* MCP tool call, flow module or gateway, failed with `MCP client failure … Target entity not found` and never reached `StartFlowModuleExecution`. The AI agent's security profile is linked to the agent's bare, `:$LATEST` and `:$SAVED` ARNs, not to numbered versions; this is our explanation, not documented.
3. **The security profile must be linked on the `:$SAVED` agent ARN** too; the console reads it there ("Permissions: Insufficient" otherwise). `deploy.mjs` links both.
4. **Flow-module tools: at most 10 top-level inputs** (deploy error) → `chooseComboItems` split from `updateCart`.
5. **CLI test chats** need the participant websocket opened and subscribed, plus heartbeats; `ConnectParticipant: true` is invalid for a customer.
6. Tool failures are visible only in Q Connect trace spans (`ListSpans`, `execute_tool`): `node infra/connect/spans.mjs <contactId>`.

**Tool transport changed to Bedrock AgentCore Gateway** (user decision during the "Target entity not found" hunt, before finding cause 2). Gateway `burger-tools` (`burger-tools-wt7pksbavt`), Lambda target `burger`, tools `burger___<name>`. Inbound auth = Connect's JWT: discovery URL `<instance URL>/.well-known/openid-configuration`, allowed audience = gateway id, MCP version `2025-03-26` ([docs](https://docs.aws.amazon.com/connect/latest/adminguide/3p-apps-mcp-server.html)). The adapter Lambda receives the tool arguments as the event and the tool name in `context.clientContext.custom.bedrockAgentCoreToolName`. Agent tool id: `gateway_<gatewayId>__<target>___<tool>`. Security profile: `Applications: [{Namespace: <gatewayId>, Type: "MCP", ApplicationPermissions: ["burger___…"]}]`. Cost: $0.005 per 1,000 calls, $0.02 per 100 indexed tools a month. Flow modules would probably also work now that cause 2 is fixed (untested); the gateway stays because it is the documented MCP path and needs no per-version module ids.

Console-only steps (no documented API): adding the gateway as an **MCP server integration** (AWS console → Amazon Connect → Integrations; the gateway list needed a page reload after creation). `AppIntegrations CreateApplication` has `ApplicationType: MCP_SERVER`, but its fields for a gateway are undocumented, so it is not used.

### Spike A plan (needs approval: creates a Connect instance + Q Connect assistant/domain + Lambda)
1. Create a Connect instance (us-east-1 or the chosen region), and confirm `MESSAGE_STREAMING=true`.
2. Create the Connect AI domain (assistant), and note `assistantId`.
3. Lambda `spike-a-update-session`: log the full event, read `ContactId` from the event, call `connect:DescribeContact` → `Contact.WisdomInfo.SessionArn` → parse `assistantId`/`sessionId`, then call `qconnect:UpdateSessionData({orderState: "STEP-2"})` and return `{result: "ok"}`.
4. Flow module `SpikeAdvance` (Lambda block) → exposed as a tool.
5. Orchestrator agent copied from SelfServiceOrchestrator, with a prompt containing `<current_step>{{$.Custom.orderState}}</current_step>` and "Begin every reply by repeating the current step verbatim; when the customer says 'advance', call SpikeAdvance".
6. Flow: Connect assistant → Lambda sets `orderState="STEP-1"` → Get customer input (AI bot).
7. Test chat: expect `STEP-1`; say "advance"; **pass if the very next agent message shows `STEP-2`**.
8. Record: event shape (is ContactId present?), the DescribeContact field path, and the transcript.

### Spike B plan (reuses Spike A resources)
Enable web calling on the widget, set a voice, place a browser call from localhost. Pass if the AI agent answers and can call SpikeAdvance by voice, with no queue or human agent.

Teardown after spikes (if not continuing to Phase 3): delete the instance (this releases its flows/widget/bots), the Q Connect assistant, the Lambda, and log groups.

### Phase 3 website widget (2026-10-29)
- Website chat via the Communications Widget with JWT security: contact `b1f784a1…` connected and the flow's init logged `linkedWebCart:true`, so the signed `cartRef` attribute reached the contact.
- Two widget pitfalls, both verified: the `<script>` element's `id` must be the widget id ("Something went wrong" otherwise), and the security key is used as the raw HMAC secret, including its trailing `=` (401 on the token exchange otherwise).
- Opening hours changed to 09:00–02:00 every day; overnight windows supported in `hours.ts`. Verified by invoking the deployed adapter (`addToCart` ok at 23:00 Toronto, previously closed at 21:00).

### Spike B results (2026-10-29, web call from the widget on localhost:3001)
**PASS.** Contact `12f25a3f-1b4c-4aab-a71c-6cf17db4b899` (channel VOICE, initiation `WEBRTC_API`) ran the unchanged `burger-chat` flow: init linked the website cart (`linkedWebCart:true`), and the orchestrator handled a full spoken order. It called addToCart, updateCart, chooseComboItems, updateCart (remove), addToCart, reviewOrder and submitOrder, all `ok`, giving order PL-RT8EHB. Speech uses the Lex en_US locale voice (Joanna, neural); no Set voice block was needed. None of the instance's 22 flows contains one, so its flow-language format was not read back.
Found on the call: the model said "your order is placed" and spoke the review token as the order number in the same reply that called submitOrder, before the result came back. The order itself was correct. Fixed with a prompt rule (agent v9); not yet re-tested. Transcripts: the instance has no `CHAT_TRANSCRIPTS` storage; the conversation is readable from the Q Connect inference spans (`infra/connect/transcript.mjs`).
