# Implementation Checklist

Legend: [x] done & verified · [~] implemented, not verified on AWS · [ ] not started · [!] blocked

## Phase 0 — Feasibility
- [x] Repository inspected (empty, not a git repo)
- [x] AWS account/CLI inspected (read-only)
- [x] Official docs re-verified 2026-10-29 → `docs/aws-feasibility.md`
- [x] Draft `docs/architecture.md`
- [x] Region decision: ca-central-1 (user, 2026-10-29)
- [x] Approval to create spike resources (user, 2026-10-29)
- [x] Spike infra: Connect instance + Q Connect assistant + association (ca-central-1)
- [x] Spike A Lambda, role, AI prompt, AI agent created (script)
- [x] Spike A console steps (user) + scripted bot/flow/module
- [x] Spike A1 — mid-conversation `UpdateSessionData` reaches next model call (verified 2026-10-29; channel decision superseded by A3 below)
- [x] Spike A — identity: flow Lambda gets ContactData.ContactId; tool overrides resolve {{$.contactId}}/{{$.sessionId}}/{{$.assistantId}}
- [x] Spike A2 — flow-module MCP tool → Lambda → UpdateSessionData works (fixes: `ContactFlowModules.Execute` on the AI agent profile; object `ResultData`)
- [x] Spike A3 decision — in-turn freshness unproven → `INSTRUCTION_CHANNEL=both`
- [x] Spike B — web calling → orchestrator agent: PASS (2026-10-29, contact `12f25a3f…`, VOICE/WEBRTC_API; cart linked, full order PL-RT8EHB by voice, no flow change needed)
- [x] Record spike results (A and B in `docs/aws-feasibility.md` §7)

## Phase 1 — Domain (local code only; started with Spike B still pending, at the user's request)
- [x] Zod models, seed menu (`src/lib/domain/**/schema.ts`, `menu/seed.ts`)
- [x] `priceLine`, `deriveState`, `renderStateBlock`, state templates (`prompts/states/*.md`)
- [x] Cart service, 4 tool handlers (`src/lib/domain/tools/`), in-memory repo
- [x] §13 scenarios 1–13 and 16 as unit tests (`tests/unit/scenarios.test.ts`); 14–15 need HTTP auth → Phase 2
- [x] `npm run typecheck` and `npm test` pass locally (39 tests)
- [x] Connect tool adapter Lambda → done in Phase 3

## Phase 2 — Persistence, admin, customer pages (local; no AWS resources created)
- [x] DynamoDB repository: single table, `byStatus` GSI, `TransactWriteItems` submit (`src/lib/repositories/dynamo/`)
- [x] DynamoDB repo verified on **real DynamoDB (ca-central-1)**, 2026-10-29: all 5 contract tests pass (conditional writes, atomic submit incl. a concurrent double submit, status GSI + `since`, sessions). `npm run test:aws` creates 5 short-lived `burger-test-*` on-demand tables and deletes them afterwards; `npm run aws:cleanup-test-tables -- --yes` removes leftovers. Plain `npm test` never touches AWS.
- [x] Admin auth: one admin account from env (scrypt hash + HMAC-signed httpOnly SameSite=Strict cookie, 8 h), lockout after 5 failures, Origin check on every mutation
- [x] Admin pages `/admin`, `/admin/orders`, `/admin/menu`, `/admin/settings`, `/admin/login`; every page and every `/api/admin/*` handler checks the session itself
- [x] Customer pages `/`, `/menu`, `/order/[id]`, live cart panel (polls 3 s), mock console (`CHAT_MODE=mock`, never in production)
- [x] Cart cookie (`cart_id`, 128-bit random, httpOnly); `/api/orders/[id]` only for the cart that placed it (§13 #15)
- [x] Done-when checks: admin changes reach `/menu` and the next state block; non-admins get 401 (§13 #14); manual order full lifecycle; duplicate submit → same order (tests + live HTTP smoke test on `next dev`)
- [ ] Admin UI only checked by HTTP status and the API tests, not by screenshots; customer pages checked by headless-Chrome screenshots (desktop + 500 px)

## Phase 3 — Connect web chat
- [x] Scripted deploy `infra/deploy/deploy.mjs`: table, adapter Lambda, AgentCore Gateway + Lambda target, orchestrator prompt + agent, default `Connect.SelfService` orchestrator (`:$LATEST`), flow `burger-chat`
- [x] Tool transport = AgentCore Gateway (flow-module tools failed with "Target entity not found"; cause found later: numbered default agent version). Console-only: MCP server integration (`docs/connect-setup.md`)
- [x] Adapter: init from the flow (signed `cartRef` → cart), tools from the gateway; identity only from `{{$.contactId}}` overrides; `action`/`cartRef` stripped from gateway args (unit-tested)
- [x] Real CLI chat GENERAL → ITEM/COMBO → CONFIRM → SUBMITTED: contact `f595d1e3…`, order `PL-HWGJM8` in DynamoDB and on `/admin` (2026-10-29)
- [x] Website chat widget with JWT: contact `b1f784a1…` connected, `linkedWebCart:true` (2026-10-29)
- [x] Opening hours past midnight (09:00–02:00): domain + schema + tests; live SETTINGS updated; deployed Lambda accepted `addToCart` at 23:00 Toronto (direct invoke, 2026-10-29)
- [x] Admin lockout off under `next dev` only (user request; still on in production builds)
- [~] `chat-test.mjs` stops cleanly when the AI ends the chat (fix written, syntax-checked; not yet run against a real chat)
- [ ] Not run as real chats: §13 off-menu / prompt-injection / closed-shop scenarios. Covered by unit tests only
- [ ] Clean-up awaiting user decision: unused flow modules `burger-tool-*`, spike modules, spike agent, spike flow
- [ ] Rotate the widget security key (it appeared in a session log) and optionally `SESSION_SECRET`

## Phase 4 — Web voice (Spike B passed)
- [x] Web calling enabled on `burger-chat-widget` (console); same flow `burger-chat`, Lex en_US voice Joanna (neural)
- [x] Transcript tool `infra/connect/transcript.mjs <contactId>` (from AI trace spans; no transcript storage configured)
- [~] Prompt fix: no outcome or order number in the reply that calls a tool (the voice call spoke the reviewToken as the order number). Deployed (agent v9), not yet re-tested
- [~] Voice wording: flow passes `$.Channel` at init → adapter stores it on the session and starts every state block with `CHANNEL: VOICE|CHAT` (model args can't set it; unit-tested) → prompt section for voice (short turns, no menu dump, no links, order number spelled out, one re-prompt). Deployed (Lambda, agent v10, flow), not yet tested on a call
- [x] Home page: order panel on the left when the widget is on, so the chat window (bottom right) doesn't cover it
- [~] Call transcript panel: adapter records cart → contact on a linked start (`CARTSESSION#<cartId>`); `GET /api/conversation` returns it only to the cart's cookie owner, within 1 h of the start (tested); reads Q Connect spans (`CONNECT_ASSISTANT_ID`), checked against the earlier real call. Updates per AI reply, not live speech. Not yet seen in the browser
- [ ] One more full voice order after the fixes
## Phase 5 — Tests, observability, security
## Phase 6 — Deployment & portfolio docs
