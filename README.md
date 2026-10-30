# AI Burger Ordering on Amazon Connect

A pickup-ordering site for a fictional burger restaurant. Customers order by chat or by a voice call in the browser; an Amazon Connect AI agent takes the order, and staff manage orders, the menu and opening hours in an admin area.

The AI never decides prices or what happens next. A state machine in plain TypeScript (`deriveState`) works out the order's step, and every tool result hands the model a fresh "state block" with the cart, the prices and the instructions for that step. The model only talks and calls tools.

## How it fits together

- **Website** (Next.js 16): menu, live order panel, call transcript, admin. API route handlers over a domain layer with no AWS imports.
- **Amazon Connect**: Communications Widget (chat + web calling, JWT-signed `cartRef` so the AI picks up the website cart) → contact flow → orchestrator AI agent.
- **Tools**: Bedrock AgentCore Gateway (MCP) → one Lambda adapter → the same domain tool handlers the website uses.
- **Data**: one DynamoDB table (carts, orders, sessions, menu, settings).

Details: [`docs/architecture.md`](docs/architecture.md), findings and verified AWS behaviour: [`docs/aws-feasibility.md`](docs/aws-feasibility.md), console steps: [`docs/connect-setup.md`](docs/connect-setup.md), progress: [`docs/implementation-checklist.md`](docs/implementation-checklist.md).

## Run locally

```bash
npm install
cp .env.example .env.local   # mock mode works with no AWS at all
npm run hash-password -- --write
npm run dev                  # http://localhost:3001
npm test                     # unit + integration tests, no AWS
```

`CHAT_MODE=mock` gives a local tool console instead of the Connect chat. The Connect setup needs your own AWS account: copy `.env.deploy.example` to `.env.deploy`, then see `docs/connect-setup.md` and `infra/deploy/deploy.mjs`.

## Status

Phases 0–3 (domain, admin, Connect web chat) are done and verified on AWS; web voice (Phase 4) works and is being polished. The restaurant, menu and contact details are fictional.
