import header from "../../prompts/states/_header.md";
import COMBO_CONFIG from "../../prompts/states/COMBO_CONFIG.md";
import CONFIRM from "../../prompts/states/CONFIRM.md";
import GENERAL from "../../prompts/states/GENERAL.md";
import ITEM_CONFIG from "../../prompts/states/ITEM_CONFIG.md";
import SUBMITTED from "../../prompts/states/SUBMITTED.md";
import { createConnectAdapter, gatewayEvent, type ConnectEvent } from "../lib/connect/adapter/handler";
import { QConnectSessionData } from "../lib/connect/session/qconnectSessionData";
import { CartService } from "../lib/domain/cart/service";
import { createToolHandlers, renderCurrent } from "../lib/domain/tools/handlers";
import { DynamoRepository } from "../lib/repositories/dynamo/dynamoRepository";

// Lambda entry for the Connect tool adapter. Built by infra/deploy/build-lambda.mjs.
const env = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
};

const repo = new DynamoRepository({ tableName: env("TABLE_NAME") });
const service = new CartService({ repo });
const toolDeps = {
  service,
  repo,
  templates: { _header: header, GENERAL, ITEM_CONFIG, COMBO_CONFIG, CONFIRM, SUBMITTED },
  statusUrlBase: env("PUBLIC_BASE_URL"),
};

const adapter = createConnectAdapter({
  repo,
  tools: createToolHandlers(toolDeps),
  currentState: (cartId) => renderCurrent(toolDeps, cartId),
  sessionData: new QConnectSessionData({ instanceId: env("INSTANCE_ID") }),
}) satisfies (event: ConnectEvent) => Promise<Record<string, string>>;

interface LambdaContext {
  clientContext?: { custom?: Record<string, unknown>; Custom?: Record<string, unknown> };
}

/** Contact-flow calls (init) arrive as Connect events; AgentCore Gateway tool calls carry the tool name in the client context. */
export async function handler(event: unknown, context?: LambdaContext) {
  const custom = context?.clientContext?.custom ?? context?.clientContext?.Custom;
  const gatewayTool = custom?.bedrockAgentCoreToolName;
  if (typeof gatewayTool === "string") return adapter(gatewayEvent((event ?? {}) as Record<string, unknown>, gatewayTool));
  if (!(event as ConnectEvent)?.Details) {
    // Neither a flow event nor a recognised gateway call: log the shape (key names only, never values).
    console.log(JSON.stringify({ level: "warn", msg: "unrecognised event", eventKeys: Object.keys(event ?? {}), clientContext: shape(context?.clientContext) }));
  }
  return adapter(event as ConnectEvent);
}

function shape(v: unknown, depth = 0): unknown {
  if (v === null || typeof v !== "object") return typeof v;
  if (depth > 2) return "object";
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x, depth + 1)]));
}
