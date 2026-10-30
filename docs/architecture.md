# Architecture

Status: **Phase 3 done (web chat).** Spike B (voice) is still pending; sections marked ❓ depend on it.

## Layers

```
Customer UI (Next.js) ──► Connect Communications Widget (chat [+ web calling ❓ Spike B])
   │ /, /menu, /order/[id]     │ JWT (HS256, widget security key) carries attributes.cartRef
   │ cart panel                ▼
   │              Contact flow: Connect assistant → Lambda(init session data) → Get customer input (AI bot)
   │                           ▼
   │              Orchestrator AI agent burger-orchestrator (default Connect.SelfService, :$LATEST)
   │                system prompt: static rules … <current_step>{{$.Custom.orderState}}</current_step>
   │                           │ MCP tools via AgentCore Gateway burger-tools (Connect JWT inbound auth):
   │                           │ addToCart, chooseComboItems(→updateCart), updateCart, reviewOrder, submitOrder
   │                           ▼
   │              Connect Tool Adapter (Lambda) — only code that knows Connect/gateway shapes
   │                ├─ init (flow Lambda block): signed cartRef → existing web cart, else new cart
   │                ├─ resolve contactId (from Connect event, never from model) → cartId
   │                ├─ call domain tool handler
   │                └─ INSTRUCTION_CHANNEL=session_data → UpdateSessionData(orderState)   ✅ Spike A1
   │                                               =tool_result  → state block in tool output
   ▼                                                            ▼
Customer API (Next.js route handlers) ──► Domain (pure TS, no AWS imports)
                                           menu · pricing(priceLine) · cart · stateMachine(deriveState)
                                           · stateBlock(renderStateBlock) · order(submit)
                                                                │
                                              Repository interface → memory | DynamoDB single table
Admin UI (/admin) ──► Admin API (authN + admin role) ───────────┘
```

## Key decisions

| Decision | Choice | Reason |
|---|---|---|
| Tool transport | **AgentCore Gateway** (Lambda target) → one adapter Lambda | Phase 3: flow-module tools failed in the real agent ("Target entity not found"); switched to the documented MCP path (user decision). Cause found later: the default agent must be `:$LATEST`. Gateway cost ≈ $0.005 per 1,000 calls. Flow-module code kept, unused. |
| Cart identity | random `cartId` in httpOnly cookie + signed JWT attribute `cartRef` | The documented integrity mechanism; a contact ID alone is never a credential |
| Session identity for tools | tool input overrides `{{$.contactId}}`/`{{$.sessionId}}`/`{{$.assistantId}}` (verified in the trace); the adapter ignores any other id source | Prompt-injection proof (§13 #13) |
| Money | integer cents; `priceLine` is the only pricing function | §3 |
| State | derived by `deriveState`, never stored | §5.2 |
| Region | **ca-central-1** (user choice, 2026-10-29) | Global CRIS caveat — see aws-feasibility §2 |
| `INSTRUCTION_CHANNEL` | **`both`**: `UpdateSessionData` + state block in the tool result | Spike A1/A2 PASS: updates reach the next customer turn; A3: same-turn visibility after a tool is unproven (aws-feasibility §7) |

## Spike results
See `aws-feasibility.md` §7. A1 + A2 PASS, A3 decided (`both`); B pending. Phase 3 findings are in the same section.

## Phase 1 domain code (local)

| Piece | File | Notes |
|---|---|---|
| State block | `src/lib/domain/stateBlock/renderStateBlock.ts` | `{{key}}` fill over `prompts/states/*.md`; an unfilled placeholder throws. Header carries shop-closed and last-error notices. |
| Template loader | `src/lib/prompts/loadStateTemplates.ts` | The only fs access; the domain stays I/O-free. |
| Tool inputs | `src/lib/domain/tools/schemas.ts` | All fields are strings (the Connect flow-module constraint); `""` means not given; unknown keys (prices, cart/contact ids) are dropped. |
| Tool handlers | `src/lib/domain/tools/handlers.ts` | `(ctx {cartId}, rawInput) → {ok, state, error?, stateBlock}`. A failed call still returns the current block. `cartId` comes only from `ctx`, which the Phase 3 adapter resolves from the override ids. |

## Phase 2 web app (local)

| Piece | File | Notes |
|---|---|---|
| HTTP handlers | `src/lib/http/{customerApi,adminApi}.ts` | Plain `Request → Response`, tested without Next. `src/app/api/**/route.ts` are one-line wrappers. |
| Container | `src/lib/server/container.ts`, `config.ts` | Env-driven (`.env.example`). `REPOSITORY=memory` refused in production; mock console never on in production. |
| DynamoDB | `src/lib/repositories/dynamo/dynamoRepository.ts` | `pk` only + GSI `byStatus` (`gsi1pk=STATUS#<s>`, `gsi1sk=createdAt`). Cart put: `version = :v AND attribute_not_exists(orderId)`. Submit: one transaction (order `attribute_not_exists(pk)` + cart `SET orderId` with the same condition). Menu/settings seed on first read. Table definition: `scripts/create-local-table.mjs` (CDK in Phase 6). |
| Admin | `src/lib/domain/admin/service.ts`, `src/lib/auth/*` | All admin writes are conditional on the `updatedAt` the admin loaded (409 on a stale edit). Order status moves only along `canTransition`. |
| Customer identity | `cart_id` cookie (+ `past_carts` so earlier orders stay viewable) | No endpoint takes a cart id. The cart id is never sent to the browser in a body. |

Decisions taken in Phase 2 (ordinary implementation details, per §17.15):
- **Admin auth = one env-configured account**, not Cognito. No cloud resource and no cost; enough for one restaurant. Secrets move to Secrets Manager in Phase 6. Revisit if more staff accounts are needed.
- **Imports are extension-less** (`moduleResolution: Bundler`). Turbopack did not resolve `.js` → `.ts` for modules reached through the `@/` alias.
- **Polling instead of push** for the cart panel (3 s) and the admin queue (10 s): no WebSocket infrastructure.

## Phase 3 Connect web chat

| Piece | File | Notes |
|---|---|---|
| Adapter | `src/lib/connect/adapter/handler.ts`, `src/lambda/toolAdapter.ts` | One Lambda, two entry points: flow event (`action=init`) and gateway call (tool name in `context.clientContext.custom.bedrockAgentCoreToolName`). Gateway args lose `action`/`cartRef`, so the model can't reach init. Logs contactId, tool, ok, state, error code; never args or the block. |
| Deploy | `infra/deploy/deploy.mjs`, `tools.mjs`, `config.mjs` | Idempotent steps; one tool list feeds the gateway schema, the agent tool config (with `{{$.contactId}}` override) and the security profile. |
| Widget | `src/components/customer/ChatWidget.tsx`, `/api/connect/widget-token` | HS256 JWT (`sub` = widget id, 5 min) with `attributes.cartRef`, a short-lived reference to the cookie's cart. |
| Opening hours | `src/lib/domain/settings/hours.ts` | A window belongs to the day it opens; `close <= open` runs past midnight. |
| Test tools | `infra/connect/chat-test.mjs`, `spans.mjs` | Real chats from the terminal; Q Connect trace spans for tool errors. |
