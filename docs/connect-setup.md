# Connect Console Setup

Every step here is done in the Connect admin website, because the API/CLI path is unavailable or undocumented. The reason is given for each step.
Instance admin site: `https://<instance-alias>.my.connect.aws/` (log in from the AWS console → Amazon Connect → instance → *Log in for emergency access*).

---

## Spike A — mid-conversation prompt update

Already created by script (2026-10-29, ca-central-1):

| Resource | Id |
|---|---|
| Lambda `burger-spike-a-update-session` | associated with the instance |
| AI prompt `burger-spike-a-orchestration` | `284c15e9-0149-4119-abd8-364089cc3104` v1 (model `us.anthropic.claude-haiku-4-5-20251001-v1:0`) |
| AI agent `burger-spike-a-agent` (ORCHESTRATION, tool: `Complete` only) | `87d12493-b594-4dbb-9bc3-2792cbec220e` |

### Step 1 — ✅ now scripted (2026-10-29)
Built once in the console, then read back with `DescribeContactFlowModule` to learn the real formats:
- `Settings` = `{"input":{"schema":<JSON schema>},"resultData":{"schema":<JSON schema>}}`
- Return block = action `EndFlowModuleExecution` with `Parameters.ResultData`
- The tool switch = `ExternalInvocationConfiguration.Enabled`, which **can only be set on create** (no update API has it)
- The AI agent security profile = `CreateSecurityProfile.AllowedFlowModules: [{Type:"MCP", FlowModuleId}]`

Scripted resources: module `SpikeAdvanceTool` `279dd4e3-b827-4ed4-810b-a84a3dc24c5d` v1 (from `infra/connect/modules/spike-advance.*.json`), security profile `burger-ai-agent` `d22909d8-7de1-43d2-85f6-7fb781ce2a34`. The console-built `SpikeAdvance` is archived. It had a key-case bug (`contactID` vs schema `contactId`) that the read-back caught.

<details><summary>Original console steps (kept for reference)</summary>

### Step 1 (console, superseded)
1. **Routing → Flows → Modules → Create flow module**, name `SpikeAdvance`.
2. Module **Settings → Input**: schema with three string properties: `contactId`, `sessionId`, `assistantId` (none required).
   **Output**: one string property `result`.
3. Add an **AWS Lambda function** block:
   - Function: `burger-spike-a-update-session`; execution **synchronous**; response validation **STRING_MAP**.
   - Parameters (set dynamically): `contactId` ← `$.Modules.Input.contactId`, `sessionId` ← `$.Modules.Input.sessionId`, `assistantId` ← `$.Modules.Input.assistantId`; set manually: `orderState` = `STEP-2`.
4. **Return** block: output `result` = `$.External.result`. Connect the Lambda error branch to a Return as well.
5. **Save → Publish**, and create a version. If the module page has a "use as tool" option, enable it.

</details>

### Step 2 — Attach the tool to the AI agent (console once: the `toolId` format for flow-module tools is undocumented; read back afterwards)
1. **AI agent designer → AI agents → `burger-spike-a-agent` → Add tool** → choose the `SpikeAdvance` module (the published version).
2. Instruction: `Call when the customer says "advance".`
3. **Override input values** (these are the identity-source test cases; constants support template variables, as the system `Retrieve` tool shows with `{{$.assistantId}}`):
   - `contactId` = `{{$.contactId}}`
   - `sessionId` = `{{$.sessionId}}`
   - `assistantId` = `{{$.assistantId}}`
4. **Security profiles**: create a profile `burger-ai-agent` that grants access to the `SpikeAdvance` flow module, and select it on the agent. Make sure **your own admin profile** can also access the module.
5. **Publish** the agent.
6. **AI agents page → Default AI Agent Configurations → Self Service** → choose `burger-spike-a-agent`.

### Step 2 result (read back 2026-10-29)
- Flow-module tool id format: `aws_custom_flows__<moduleId>_<moduleVersion>`, toolType `MODEL_CONTEXT_PROTOCOL`.
- Overrides are stored as `overrideInputValues: [{jsonPath:"$.contactId", value:{constant:{type:"STRING", value:"{{$.contactId}}"}}}]`. Full read-back: `infra/connect/reference/burger-spike-a-agent.tools.readback.json`.
- Default self-service orchestrator: stored in `assistant.orchestratorConfigurationList` as `{orchestratorUseCase:"Connect.SelfService", aiAgentId:"<id>:$LATEST"}`. API: `UpdateAssistantAIAgent(aiAgentType=ORCHESTRATION, orchestratorUseCase="Connect.SelfService")`. **Not** `aiAgentType=SELF_SERVICE`, which rejects orchestration agents.

### Steps 3–4 — ✅ scripted (2026-10-29)
- Lex bot: `infra/spikes/lex/create-bot.mjs` (role `burger-lex-bot`, intent `AMAZON.QInConnectIntent` with `qInConnectAssistantConfiguration.assistantArn`, version 1, alias `live` `C3QAJ1I5W3`, `AssociateBot`). The alias policy includes `lex:RecognizeMessageAsync` (verified).
- Flow: `infra/connect/flows/spike-a-flow.json` → `burger-spike-a-flow` `905c847b-ec8c-4b02-a20f-00a65b25e45f` (CreateWisdomSession → Lambda `orderState=STEP-1` → ConnectParticipantWithLexBot → Disconnect).
- ⚠️ The flow-language docs say `CreateWisdomSession` is "only supported on the voice channel", yet the AWS agentic chat guide uses the Connect assistant block for chat. The test chat decides it.

<details><summary>Original console steps 3–4 (superseded)</summary>

### Step 3 — Conversational AI bot (console: needs a Lex service-linked role, which `nemaWork` cannot create via CLI)
**Routing → Flows → Conversational AI → Create**, name `burger-spike-bot`, locale English (US), and **enable the Amazon Connect AI agent intent**. Build the locale.

### Step 4 — Contact flow `burger-spike-a-flow`
**Routing → Flows → Create flow** (Inbound):
1. **Set logging behavior** → enabled.
2. **Connect assistant** → select `burger-spike-assistant`.
3. **AWS Lambda function** → `burger-spike-a-update-session`, parameter `orderState` = `STEP-1` (seeds the first step before the conversation, the documented pattern).
4. **Get customer input** → Conversational AI bot `burger-spike-bot` (alias), with the AI agent intent.
5. Default/Error → **Disconnect**.
6. **Publish.**

</details>

### Step 5 — Test (Connect "Test chat" — no widget or phone number needed)
1. In the admin site, open **Test chat** (top-right chat icon / *Test settings*) and choose the flow `burger-spike-a-flow`.
2. Say `hi` → expected reply begins with `[step: STEP-1]`.
3. Say `advance` → **PASS if the very next agent message begins with `[step: STEP-2]`**. FAIL if it still shows `STEP-1` (also try one more message: if `STEP-2` appears only one turn later, record "applied with one-turn delay").
4. Copy the transcript and tell Claude. Claude then reads the Lambda logs (`/aws/lambda/burger-spike-a-update-session`) to record which identity source worked.

---

## Phase 3 — burger ordering chat (2026-10-29)

Everything except the steps below is scripted: `node infra/deploy/deploy.mjs` runs `table → lambda → modules → gateway → agent → default-agent → flow → status` (or name one step). The `lambda` step always rebuilds the bundle first.

| Resource | Name / id |
|---|---|
| DynamoDB table | `burger-orders` |
| Adapter Lambda | `burger-tool-adapter` (role `burger-tool-adapter`) |
| AgentCore Gateway | `burger-tools` = `burger-tools-wt7pksbavt`, role `burger-gateway`, Lambda target `burger` |
| AI prompt / agent | `burger-orchestration` / `burger-orchestrator`; default `Connect.SelfService` orchestrator = `burger-orchestrator:$LATEST` |
| Security profile | `burger-ai-agent` (gateway tools + `ContactFlowModules.Execute`) |
| Contact flow | `burger-chat` |
| Chat widget | `burger-chat-widget` (console) |

### Console step 1 — MCP server integration (once; no documented API for a gateway)
1. AWS console, region **Canada (Central)** → **Amazon Connect** → left menu **Integrations** (formerly "Third-party applications") → **Add integration**.
2. **Display name** `burger-tools`, **Integration type** **MCP server**, **Gateway** `burger-tools`, **Instance association** `<instance-alias>` → **Add integration**.
3. If the gateway list is empty right after `deploy.mjs gateway`, reload the page.

After this, `deploy.mjs agent` adds the five tools and the security-profile permissions itself. You don't need the console's "Add tool" or security-profile pages, but they are a good read-back: the agent's **Tools** list shows `burger-tools` / `addToCart`… with **Permissions: Sufficient**.

### Console step 2 — chat widget (once)
**Admin site → Channels → Communication widgets → Add communication widget**:
1. **Select communication channels:** name `burger-chat-widget`, tick **Add chat**, chat contact flow **burger-chat**, Flow Alias/Version empty (= latest published). Everything else off → **Next**.
2. **Customize widget:** defaults → **Next**.
3. **Domain & security:** domain `http://localhost:3001` (add the real domain in Phase 6), security **Yes** (JWT) → **Save and continue**.
4. On the widget details page, copy into `.env.local` (never into chat or git):
   - `CONNECT_WIDGET_SCRIPT_URL` = the snippet's `src` (`…/connectwidget/static/amazon-connect-chat-interface-client.js`)
   - `CONNECT_WIDGET_ID` = the snippet's `id` (the site also uses it as the script element id, which the widget requires)
   - `CONNECT_WIDGET_SNIPPET_ID` = the value in `amazon_connect('snippetId', '…')`
   - `CONNECT_WIDGET_SECURITY_KEY` = the security key. Use the copy button: it is 44 characters and ends in `=`. A truncated key gives **401** on the widget's token call.
   - plus `CHAT_MODE=connect`, `PUBLIC_BASE_URL=http://localhost:3001`, `REPOSITORY=dynamo`, `TABLE_NAME=burger-orders`, `AWS_REGION=ca-central-1`
5. Restart `npm run dev` (port 3001).

### Testing
- Browser: http://localhost:3001, add to the cart, open the chat bubble. The adapter log line `session init … linkedWebCart:true` confirms the widget's signed `cartRef` reached the flow.
- Terminal (costs a Connect chat): `node infra/connect/chat-test.mjs [--cartRef <ref>] "turn 1" "turn 2" …`. It prints the transcript and the adapter log for the contact, and stops early if the AI ends the chat.
- Tool errors: `node infra/connect/spans.mjs <contactId>` (Q Connect trace spans; argument keys only).
- Opening hours live in the SETTINGS item (admin → Settings). A window whose close is at or before its open runs past midnight (09:00–02:00). Connect has no hours-of-operation check of its own in `burger-chat`.
