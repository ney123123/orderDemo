// Names for the deployed resources, plus the account-specific ids from Phase 0, which are read from the
// gitignored .env.deploy (see .env.deploy.example) so they stay out of the public repo. No secrets here.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const envFile = fileURLToPath(new URL("../../.env.deploy", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);
const need = (name) => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}: copy .env.deploy.example to .env.deploy and fill it in`);
  return v;
};

export const REGION = "ca-central-1";
export const ACCOUNT = need("AWS_ACCOUNT_ID");
export const INSTANCE_ID = need("CONNECT_INSTANCE_ID");
export const INSTANCE_ARN = `arn:aws:connect:${REGION}:${ACCOUNT}:instance/${INSTANCE_ID}`;
export const ASSISTANT_ID = need("CONNECT_ASSISTANT_ID");
export const ASSISTANT_ARN = `arn:aws:wisdom:${REGION}:${ACCOUNT}:assistant/${ASSISTANT_ID}`;
/** Security profile with ContactFlowModules.Execute (Spike A finding); the AI agent invokes tools under it. */
export const AI_SECURITY_PROFILE_ID = need("CONNECT_AI_SECURITY_PROFILE_ID");
/** Lex V2 bot with AMAZON.QInConnectIntent (created in Phase 0). */
export const LEX_BOT_ALIAS_ARN = `arn:aws:lex:${REGION}:${ACCOUNT}:bot-alias/${need("LEX_BOT_ID")}/${need("LEX_BOT_ALIAS_ID")}`;
export const MODEL_ID = "us.anthropic.claude-haiku-4-5-20251001-v1:0";

export const TABLE = "burger-orders";
export const LAMBDA = "burger-tool-adapter";
export const ROLE = "burger-tool-adapter";
export const PROMPT = "burger-orchestration";
export const AGENT = "burger-orchestrator";
export const FLOW = "burger-chat";
/** AgentCore Gateway that exposes the adapter Lambda as MCP tools (flow-module tools failed, see docs/aws-feasibility.md). */
export const GATEWAY = "burger-tools";
export const GATEWAY_ROLE = "burger-gateway";
export const GATEWAY_TARGET = "burger";
/** Connect signs the JWTs it sends the gateway; the gateway checks them against this OIDC discovery document. */
export const INSTANCE_URL = need("CONNECT_INSTANCE_URL");
export const TAGS = { project: "burger-order-demo" };
