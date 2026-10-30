// The MCP tools (§7): one definition drives the flow-module content/settings and the AI agent's
// tool configuration. Model-filled inputs are strings (Connect flow-module constraint).
// Connect allows at most 10 top-level input parameters per flow-module tool (found on deploy, 2026-10-29), so:
//   - identity is contactId only (the adapter resolves the AI session via DescribeContact), and
//   - combo choices are a separate model-facing tool, chooseComboItems, that runs the domain's updateCart.
import { createHash } from "node:crypto";

export const IDENTITY = ["contactId"];
export const MAX_INPUTS = 10;
const s = (description) => ({ type: "string", description });
const itemOptions = {
  format: s('Burgers only: "SINGLE" (on its own) or "COMBO" (with a side and a drink). Omit if not said.'),
  spicy: s('Burgers only: "yes" or "no". Omit if not said.'),
  size: s('A side or drink ordered on its own: "REGULAR" or "LARGE". Omit if not said.'),
};
const comboOptions = {
  sideId: s('Combo side id from the menu, e.g. "fries". Omit if not said.'),
  sideSize: s('Combo side size: "REGULAR" or "LARGE". Omit if not said.'),
  drinkId: s('Combo drink id from the menu, e.g. "coke_zero". Omit if not said.'),
  drinkSize: s('Combo drink size: "REGULAR" or "LARGE". Omit if not said.'),
};

export const TOOLS = [
  {
    name: "addToCart",
    instruction:
      "Add one item the customer asked for. Call once per distinct item. Fill in only what the customer actually said; the next step asks for the rest.",
    properties: { itemId: s('Menu item id, e.g. "beef", "fries", "coke".'), quantity: s('Whole number as text, default "1".'), ...itemOptions, ...comboOptions },
    required: ["itemId"],
  },
  {
    name: "updateCart",
    instruction:
      "Change a line already in the cart: on its own or combo, spicy, size, quantity, remove it, or split some units off with different options. Use the line id from CART. For a combo's side or drink use chooseComboItems.",
    properties: {
      lineId: s('Line id from CART, e.g. "L1".'),
      quantity: s("New quantity as text. Omit to keep it."),
      remove: s('"yes" to remove the whole line.'),
      splitQuantity: s('Move this many units to a new line that gets the options given in this call, e.g. "1".'),
      ...itemOptions,
    },
    required: ["lineId"],
  },
  {
    name: "chooseComboItems",
    domainTool: "updateCart",
    instruction: "Set or change the side and/or drink (and their sizes) of a combo line in the cart. Use the line id from CART. Send only what the customer chose.",
    properties: { lineId: s('Combo line id from CART, e.g. "L1".'), ...comboOptions },
    required: ["lineId"],
  },
  {
    name: "reviewOrder",
    instruction: "The customer says they are done ordering. Checks and prices the order and moves to confirmation.",
    properties: {},
    required: [],
  },
  {
    name: "submitOrder",
    instruction:
      "Place the order. Only in the confirm step, after the customer gave a name for the order and said a clear yes.",
    properties: {
      reviewToken: s("The reviewToken shown in the confirm step, exactly."),
      customerName: s("The name the customer gave for the order."),
      pickupNote: s("Optional pickup note from the customer."),
    },
    required: ["reviewToken"],
  },
];

const RESULT_FIELDS = ["ok", "state", "errorCode", "errorMessage", "stateBlock"];

export function moduleSettings(tool) {
  const count = Object.keys(tool.properties).length + IDENTITY.length;
  if (count > MAX_INPUTS) throw new Error(`${tool.name} has ${count} inputs; Connect allows ${MAX_INPUTS}`);
  const identity = Object.fromEntries(IDENTITY.map((k) => [k, { type: "string" }]));
  return {
    input: { schema: { type: "object", properties: { ...tool.properties, ...identity }, required: tool.required } },
    resultData: {
      schema: {
        type: "object",
        properties: Object.fromEntries(RESULT_FIELDS.map((k) => [k, { type: "string" }])),
        required: ["ok", "state"],
      },
    },
  };
}

/** AgentCore Gateway Lambda-target tool definition; the gateway exposes it as `<target>___<name>`. */
export function gatewayToolDefinition(tool) {
  const { input, resultData } = moduleSettings(tool);
  return { name: tool.name, description: tool.instruction, inputSchema: input.schema, outputSchema: resultData.schema };
}

/** Stable UUID per (tool, action): module action identifiers must look like the console's UUIDs. */
function actionId(tool, action) {
  const h = createHash("sha256").update(`burger-tool/${tool.name}/${action}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Module: Lambda (adapter, tool=<name>) → return its string map; on Lambda error return a fixed error. */
export function moduleContent(tool, lambdaArn) {
  const fields = [...Object.keys(tool.properties), ...IDENTITY];
  const attrs = { tool: tool.domainTool ?? tool.name, ...Object.fromEntries(fields.map((f) => [f, `$.Modules.Input.${f}`])) };
  const [invoke, ok, error] = ["invoke", "ok", "error"].map((a) => actionId(tool, a));
  return {
    Version: "2019-10-30",
    StartAction: invoke,
    Metadata: {
      entryPointPosition: { x: 40, y: 40 },
      ActionMetadata: {
        [invoke]: {
          position: { x: 240, y: 40 },
          parameters: { LambdaFunctionARN: { displayName: lambdaArn.split(":").pop() }, LambdaInvocationAttributes: Object.fromEntries(fields.map((f) => [f, { useDynamic: true }])) },
          dynamicMetadata: Object.fromEntries(Object.keys(attrs).map((k) => [k, k !== "tool"])),
        },
        [ok]: { position: { x: 520, y: 20 }, parameters: { ResultData: Object.fromEntries(RESULT_FIELDS.map((k) => [k, { useDynamic: true }])) } },
        [error]: { position: { x: 520, y: 220 } },
      },
      Annotations: [],
    },
    Actions: [
      {
        Identifier: invoke,
        Type: "InvokeLambdaFunction",
        Parameters: {
          LambdaFunctionARN: lambdaArn,
          InvocationTimeLimitSeconds: "8",
          InvocationType: "SYNCHRONOUS",
          LambdaInvocationAttributes: attrs,
          ResponseValidation: { ResponseType: "STRING_MAP" },
        },
        Transitions: { NextAction: ok, Errors: [{ NextAction: error, ErrorType: "NoMatchingError" }] },
      },
      {
        Identifier: ok,
        Type: "EndFlowModuleExecution",
        Parameters: { ResultData: Object.fromEntries(RESULT_FIELDS.map((k) => [k, `$.External.${k}`])) },
        Transitions: {},
      },
      {
        Identifier: error,
        Type: "EndFlowModuleExecution",
        Parameters: {
          ResultData: {
            ok: "false",
            state: "UNKNOWN",
            errorCode: "ADAPTER_ERROR",
            errorMessage: "The ordering system did not respond.",
            stateBlock: "",
          },
        },
        Transitions: {},
      },
    ],
    Settings: {
      InputParameters: [],
      OutputParameters: [],
      Transitions: [
        { DisplayName: "Success", ReferenceName: "Success", Description: "" },
        { DisplayName: "Error", ReferenceName: "Error", Description: "" },
      ],
    },
  };
}

/** The AI agent's tool entry (a gateway tool); identity inputs are overridden by Connect, never filled by the model. */
export function agentToolConfiguration(tool, toolId) {
  return {
    toolName: tool.name,
    toolType: "MODEL_CONTEXT_PROTOCOL",
    toolId,
    title: toolId,
    description: tool.instruction,
    instruction: { instruction: tool.instruction, examples: [] },
    overrideInputValues: IDENTITY.map((k) => ({ jsonPath: `$.${k}`, value: { constant: { type: "STRING", value: `{{$.${k}}}` } } })),
    inputSchema: moduleSettings(tool).input.schema,
    userInteractionConfiguration: { isUserConfirmationRequired: false },
  };
}
