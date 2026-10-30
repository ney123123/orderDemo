// Phase 3 deploy, step by step and idempotent (finds resources by name; re-running updates them).
// Usage: node infra/deploy/deploy.mjs <table|lambda|modules|agent|default-agent|gateway|flow|status>
// PUBLIC_BASE_URL (for the order-status link the AI gives) defaults to http://localhost:3001.
// Uses the default AWS credentials (IAM user nemaWork). Creates only burger-* resources.
import * as Connect from "@aws-sdk/client-connect";
import * as Ac from "@aws-sdk/client-bedrock-agentcore-control";
import * as Ddb from "@aws-sdk/client-dynamodb";
import * as Iam from "@aws-sdk/client-iam";
import * as Lambda from "@aws-sdk/client-lambda";
import * as Logs from "@aws-sdk/client-cloudwatch-logs";
import * as Q from "@aws-sdk/client-qconnect";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tableDefinition } from "../../scripts/create-local-table.mjs";
import * as C from "./config.mjs";
import { agentToolConfiguration, gatewayToolDefinition, moduleContent, moduleSettings, TOOLS } from "./tools.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const region = C.REGION;
const connect = new Connect.ConnectClient({ region, maxAttempts: 8 });
const ddb = new Ddb.DynamoDBClient({ region });
const iam = new Iam.IAMClient({ region });
const lambda = new Lambda.LambdaClient({ region });
const logs = new Logs.CloudWatchLogsClient({ region });
const q = new Q.QConnectClient({ region });
const ac = new Ac.BedrockAgentCoreControlClient({ region });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? "http://localhost:3001";
const lambdaArn = `arn:aws:lambda:${region}:${C.ACCOUNT}:function:${C.LAMBDA}`;

async function table() {
  try {
    await ddb.send(new Ddb.CreateTableCommand({ ...tableDefinition(C.TABLE), Tags: Object.entries(C.TAGS).map(([Key, Value]) => ({ Key, Value })) }));
    console.log("table: creating", C.TABLE);
  } catch (e) {
    if (e.name !== "ResourceInUseException") throw e;
    console.log("table: exists", C.TABLE);
  }
  await Ddb.waitUntilTableExists({ client: ddb, maxWaitTime: 300 }, { TableName: C.TABLE });
  const ttl = await ddb.send(new Ddb.DescribeTimeToLiveCommand({ TableName: C.TABLE }));
  if (ttl.TimeToLiveDescription?.TimeToLiveStatus !== "ENABLED") {
    await ddb.send(new Ddb.UpdateTimeToLiveCommand({ TableName: C.TABLE, TimeToLiveSpecification: { Enabled: true, AttributeName: "ttl" } }));
    console.log("table: TTL enabled on ttl");
  }
  const d = (await ddb.send(new Ddb.DescribeTableCommand({ TableName: C.TABLE }))).Table;
  console.log("table:", d.TableStatus, d.BillingModeSummary?.BillingMode, "GSI", d.GlobalSecondaryIndexes?.map((g) => `${g.IndexName}=${g.IndexStatus}`).join(","));
}

function rolePolicy() {
  const tableArn = `arn:aws:dynamodb:${region}:${C.ACCOUNT}:table/${C.TABLE}`;
  return {
    Version: "2012-10-17",
    Statement: [
      { Effect: "Allow", Action: ["logs:CreateLogStream", "logs:PutLogEvents"], Resource: `arn:aws:logs:${region}:${C.ACCOUNT}:log-group:/aws/lambda/${C.LAMBDA}:*` },
      {
        Effect: "Allow",
        Action: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:Query", "dynamodb:ConditionCheckItem"],
        Resource: [tableArn, `${tableArn}/index/*`],
      },
      { Effect: "Allow", Action: "connect:DescribeContact", Resource: `${C.INSTANCE_ARN}/contact/*` },
      { Effect: "Allow", Action: "wisdom:UpdateSessionData", Resource: `arn:aws:wisdom:${region}:${C.ACCOUNT}:session/${C.ASSISTANT_ID}/*` },
    ],
  };
}

async function deployLambda() {
  // Role (least privilege: this table, this instance's contacts, this assistant's sessions, its own logs).
  const trust = { Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { Service: "lambda.amazonaws.com" }, Action: "sts:AssumeRole" }] };
  try {
    await iam.send(new Iam.CreateRoleCommand({ RoleName: C.ROLE, AssumeRolePolicyDocument: JSON.stringify(trust), Description: "Connect tool adapter for burger ordering", Tags: Object.entries(C.TAGS).map(([Key, Value]) => ({ Key, Value })) }));
    console.log("role: created", C.ROLE);
  } catch (e) {
    if (e.name !== "EntityAlreadyExistsException") throw e;
    console.log("role: exists", C.ROLE);
  }
  await iam.send(new Iam.PutRolePolicyCommand({ RoleName: C.ROLE, PolicyName: "adapter", PolicyDocument: JSON.stringify(rolePolicy()) }));
  const roleArn = `arn:aws:iam::${C.ACCOUNT}:role/${C.ROLE}`;

  // Log group first, so retention is set before the first invocation creates it.
  try {
    await logs.send(new Logs.CreateLogGroupCommand({ logGroupName: `/aws/lambda/${C.LAMBDA}`, tags: C.TAGS }));
  } catch (e) {
    if (e.name !== "ResourceAlreadyExistsException") throw e;
  }
  await logs.send(new Logs.PutRetentionPolicyCommand({ logGroupName: `/aws/lambda/${C.LAMBDA}`, retentionInDays: 14 }));

  // Always rebuild: uploading a stale zip once shipped old code (Phase 3, 2026-10-29).
  execFileSync(process.execPath, [join(root, "infra/deploy/build-lambda.mjs")], { stdio: "inherit" });
  const ZipFile = readFileSync(join(root, "dist/lambda/toolAdapter.zip"));
  const Environment = { Variables: { TABLE_NAME: C.TABLE, INSTANCE_ID: C.INSTANCE_ID, PUBLIC_BASE_URL, NODE_OPTIONS: "--enable-source-maps" } };
  let exists = true;
  try {
    await lambda.send(new Lambda.GetFunctionCommand({ FunctionName: C.LAMBDA }));
  } catch (e) {
    if (e.name !== "ResourceNotFoundException") throw e;
    exists = false;
  }
  if (!exists) {
    // A new role takes a few seconds to become assumable by Lambda.
    for (let i = 0; ; i++) {
      try {
        await lambda.send(new Lambda.CreateFunctionCommand({
          FunctionName: C.LAMBDA, Runtime: "nodejs22.x", Architectures: ["arm64"], Handler: "index.handler",
          Role: roleArn, Code: { ZipFile }, MemorySize: 512, Timeout: 8, Environment, Tags: C.TAGS,
          Description: "Connect MCP tools → burger domain (addToCart, updateCart, reviewOrder, submitOrder)",
        }));
        console.log("lambda: created", C.LAMBDA);
        break;
      } catch (e) {
        if (e.name !== "InvalidParameterValueException" || i > 10) throw e;
        await sleep(3000);
      }
    }
  } else {
    await lambda.send(new Lambda.UpdateFunctionCodeCommand({ FunctionName: C.LAMBDA, ZipFile }));
    await Lambda.waitUntilFunctionUpdatedV2({ client: lambda, maxWaitTime: 120 }, { FunctionName: C.LAMBDA });
    await lambda.send(new Lambda.UpdateFunctionConfigurationCommand({ FunctionName: C.LAMBDA, Environment, Timeout: 8, MemorySize: 512, Role: roleArn }));
    console.log("lambda: updated code + config", C.LAMBDA);
  }
  await Lambda.waitUntilFunctionActiveV2({ client: lambda, maxWaitTime: 120 }, { FunctionName: C.LAMBDA });
  await Lambda.waitUntilFunctionUpdatedV2({ client: lambda, maxWaitTime: 120 }, { FunctionName: C.LAMBDA });

  // Let Connect invoke it (adds the Lambda resource policy for this instance).
  try {
    await connect.send(new Connect.AssociateLambdaFunctionCommand({ InstanceId: C.INSTANCE_ID, FunctionArn: lambdaArn }));
    console.log("lambda: associated with Connect instance");
  } catch (e) {
    if (e.name !== "ResourceConflictException") throw e;
    console.log("lambda: already associated");
  }
}

/**
 * AgentCore Gateway → adapter Lambda (one target, one tool per TOOLS entry). Inbound auth is Connect's own
 * JWT: discovery URL = the instance's OIDC document, allowed audience = the gateway id (docs: 3p-apps-mcp-server).
 * The Connect side (MCP server integration, security profile, agent tools) is set in the console, see docs/connect-setup.md.
 */
async function gateway() {
  const roleArn = await ensureRole(C.GATEWAY_ROLE, "bedrock-agentcore.amazonaws.com", "AgentCore Gateway for burger tools", {
    Version: "2012-10-17",
    Statement: [{ Effect: "Allow", Action: "lambda:InvokeFunction", Resource: lambdaArn }],
  });
  const protocolConfiguration = { mcp: { supportedVersions: ["2025-03-26"] } };
  const auth = (audience) => ({ customJWTAuthorizer: { discoveryUrl: `${C.INSTANCE_URL}/.well-known/openid-configuration`, allowedAudience: [audience] } });

  let g = (await ac.send(new Ac.ListGatewaysCommand({}))).items?.find((x) => x.name === C.GATEWAY);
  if (!g) {
    g = await ac.send(new Ac.CreateGatewayCommand({
      name: C.GATEWAY, description: "Burger ordering tools for the Connect AI agent", roleArn, protocolType: "MCP", protocolConfiguration,
      authorizerType: "CUSTOM_JWT", authorizerConfiguration: auth(C.GATEWAY), tags: C.TAGS,
    }));
    console.log("gateway: created", g.gatewayId);
  }
  const gatewayId = g.gatewayId;
  await waitReady(() => ac.send(new Ac.GetGatewayCommand({ gatewayIdentifier: gatewayId })), "gateway");
  await ac.send(new Ac.UpdateGatewayCommand({
    gatewayIdentifier: gatewayId, name: C.GATEWAY, description: "Burger ordering tools for the Connect AI agent", roleArn, protocolType: "MCP",
    protocolConfiguration, authorizerType: "CUSTOM_JWT", authorizerConfiguration: auth(gatewayId),
  }));
  await waitReady(() => ac.send(new Ac.GetGatewayCommand({ gatewayIdentifier: gatewayId })), "gateway");

  const targetConfiguration = { mcp: { lambda: { lambdaArn, toolSchema: { inlinePayload: TOOLS.map(gatewayToolDefinition) } } } };
  const credentialProviderConfigurations = [{ credentialProviderType: "GATEWAY_IAM_ROLE" }];
  const t = (await ac.send(new Ac.ListGatewayTargetsCommand({ gatewayIdentifier: gatewayId }))).items?.find((x) => x.name === C.GATEWAY_TARGET);
  const targetId = t
    ? (await ac.send(new Ac.UpdateGatewayTargetCommand({ gatewayIdentifier: gatewayId, targetId: t.targetId, name: C.GATEWAY_TARGET, targetConfiguration, credentialProviderConfigurations }))).targetId
    : (await ac.send(new Ac.CreateGatewayTargetCommand({ gatewayIdentifier: gatewayId, name: C.GATEWAY_TARGET, description: `Lambda ${C.LAMBDA}`, targetConfiguration, credentialProviderConfigurations }))).targetId;
  await waitReady(() => ac.send(new Ac.GetGatewayTargetCommand({ gatewayIdentifier: gatewayId, targetId })), "target");
  // The AI agent's profile may call these gateway tools (what the console's Tools section saves).
  await connect.send(new Connect.UpdateSecurityProfileCommand({
    InstanceId: C.INSTANCE_ID, SecurityProfileId: C.AI_SECURITY_PROFILE_ID,
    Applications: [{ Namespace: gatewayId, Type: "MCP", ApplicationPermissions: TOOLS.map((x) => `${C.GATEWAY_TARGET}___${x.name}`) }],
  }));
  const got = await ac.send(new Ac.GetGatewayCommand({ gatewayIdentifier: gatewayId }));
  console.log("gateway:", JSON.stringify({ gatewayId, gatewayUrl: got.gatewayUrl, targetId, audience: got.authorizerConfiguration?.customJWTAuthorizer?.allowedAudience, tools: TOOLS.map((x) => `${C.GATEWAY_TARGET}___${x.name}`) }, null, 1));
}

async function waitReady(get, what) {
  for (let i = 0; i < 60; i++) {
    const r = await get();
    if (r.status === "READY") return r;
    if (/FAILED/.test(r.status)) throw new Error(`${what} ${r.status}: ${JSON.stringify(r.statusReasons)}`);
    await sleep(5000);
  }
  throw new Error(`${what} not READY after 5 minutes`);
}

/** Creates/updates a burger-* service role with one inline policy; returns its ARN. */
async function ensureRole(RoleName, service, Description, policy) {
  const trust = { Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { Service: service }, Action: "sts:AssumeRole", Condition: { StringEquals: { "aws:SourceAccount": C.ACCOUNT } } }] };
  let arn;
  try {
    arn = (await iam.send(new Iam.CreateRoleCommand({ RoleName, AssumeRolePolicyDocument: JSON.stringify(trust), Description, Tags: Object.entries(C.TAGS).map(([Key, Value]) => ({ Key, Value })) }))).Role.Arn;
    console.log("role: created", RoleName);
    await sleep(10000); // IAM propagation before a service assumes it
  } catch (e) {
    if (e.name !== "EntityAlreadyExistsException") throw e;
    arn = (await iam.send(new Iam.GetRoleCommand({ RoleName }))).Role.Arn;
  }
  await iam.send(new Iam.PutRolePolicyCommand({ RoleName, PolicyName: "invoke", PolicyDocument: JSON.stringify(policy) }));
  return arn;
}

async function findModule(name) {
  let NextToken;
  do {
    const r = await connect.send(new Connect.ListContactFlowModulesCommand({ InstanceId: C.INSTANCE_ID, ContactFlowModuleState: "ACTIVE", NextToken }));
    const m = r.ContactFlowModulesSummaryList?.find((x) => x.Name === name);
    if (m) return m;
    NextToken = r.NextToken;
  } while (NextToken);
  return undefined;
}

/** ASCII only: the agent tool description is copied from it (see the Phase 3 notes in docs/aws-feasibility.md). */
const moduleDescription = (tool) => `Burger order tool ${tool.name} (calls ${C.LAMBDA})`;

/** Creates/updates the 4 tool modules, versions them, and allows them for the AI agent. Returns toolIds. */
async function modules() {
  const toolIds = {};
  for (const tool of TOOLS) {
    const name = `burger-tool-${tool.name}`;
    const Content = JSON.stringify(moduleContent(tool, lambdaArn));
    const Settings = JSON.stringify(moduleSettings(tool));
    let m = await findModule(name);
    if (!m) {
      const r = await connect.send(new Connect.CreateContactFlowModuleCommand({
        InstanceId: C.INSTANCE_ID, Name: name, Description: moduleDescription(tool), Content, Settings,
        ExternalInvocationConfiguration: { Enabled: true }, Tags: C.TAGS,
      }));
      m = { Id: r.Id };
      console.log("module: created", name, r.Id);
    } else {
      await connect.send(new Connect.UpdateContactFlowModuleContentCommand({ InstanceId: C.INSTANCE_ID, ContactFlowModuleId: m.Id, Content, Settings }));
      await connect.send(new Connect.UpdateContactFlowModuleMetadataCommand({ InstanceId: C.INSTANCE_ID, ContactFlowModuleId: m.Id, Description: moduleDescription(tool) }));
      console.log("module: updated", name, m.Id);
    }
    const v = await connect.send(new Connect.CreateContactFlowModuleVersionCommand({ InstanceId: C.INSTANCE_ID, ContactFlowModuleId: m.Id, Description: `deploy ${new Date().toISOString()}` }));
    toolIds[tool.name] = `aws_custom_flows__${m.Id}_${v.Version}`;
  }

  const cur = await connect.send(new Connect.ListSecurityProfileFlowModulesCommand({ InstanceId: C.INSTANCE_ID, SecurityProfileId: C.AI_SECURITY_PROFILE_ID }));
  const ids = new Set((cur.AllowedFlowModules ?? []).map((x) => x.FlowModuleId));
  for (const id of Object.values(toolIds)) ids.add(id.split("__")[1].split("_")[0]);
  // Permissions are re-sent on purpose: an update with AllowedFlowModules alone left new modules
  // unresolvable by the AI agent ("Target entity not found"; Phase 3 test chats, 2026-10-29).
  await connect.send(new Connect.UpdateSecurityProfileCommand({
    InstanceId: C.INSTANCE_ID, SecurityProfileId: C.AI_SECURITY_PROFILE_ID, Permissions: ["ContactFlowModules.Execute"],
    AllowedFlowModules: [...ids].map((FlowModuleId) => ({ Type: "MCP", FlowModuleId })),
  }));
  console.log("security profile: allowed modules", ids.size);
  console.log(JSON.stringify(toolIds, null, 1));
  return toolIds;
}

async function findByName(list, key, name) {
  let nextToken;
  do {
    const r = await q.send(list(nextToken));
    const hit = r[key]?.find((x) => x.name === name);
    if (hit) return hit;
    nextToken = r.nextToken;
  } while (nextToken);
  return undefined;
}

/** Tool ids of the gateway tools, as the console stores them: gateway_<gatewayId>__<target>___<tool>. */
async function gatewayToolIds() {
  const g = (await ac.send(new Ac.ListGatewaysCommand({}))).items?.find((x) => x.name === C.GATEWAY);
  if (!g) throw new Error(`Gateway ${C.GATEWAY} not found; run the gateway step first`);
  return Object.fromEntries(TOOLS.map((t) => [t.name, `gateway_${g.gatewayId}__${C.GATEWAY_TARGET}___${t.name}`]));
}

async function agent() {
  const toolIds = await gatewayToolIds();
  const text = readFileSync(join(root, "prompts/orchestration.yaml"), "utf8");
  const assistantId = C.ASSISTANT_ID;

  // Prompt
  let p = await findByName((nextToken) => new Q.ListAIPromptsCommand({ assistantId, nextToken }), "aiPromptSummaries", C.PROMPT);
  const templateConfiguration = { textFullAIPromptEditTemplateConfiguration: { text } };
  if (!p) {
    const r = await q.send(new Q.CreateAIPromptCommand({
      assistantId, name: C.PROMPT, type: "ORCHESTRATION", apiFormat: "MESSAGES", templateType: "TEXT", modelId: C.MODEL_ID,
      visibilityStatus: "PUBLISHED", templateConfiguration, tags: C.TAGS, description: "Burger order taker (prompts/orchestration.yaml)",
    }));
    p = r.aiPrompt;
    console.log("prompt: created", p.aiPromptId);
  } else {
    await q.send(new Q.UpdateAIPromptCommand({ assistantId, aiPromptId: p.aiPromptId, visibilityStatus: "PUBLISHED", templateConfiguration, modelId: C.MODEL_ID }));
    console.log("prompt: updated", p.aiPromptId);
  }
  const pv = await q.send(new Q.CreateAIPromptVersionCommand({ assistantId, aiPromptId: p.aiPromptId }));

  // Agent: 4 MCP tools + Complete (Return to Control). No Escalate: there are no human agents (§10).
  const complete = {
    toolName: "Complete",
    toolType: "RETURN_TO_CONTROL",
    instruction: { instruction: "End the chat only after the order is placed (or the customer is not ordering) and the customer has said they need nothing else." },
    inputSchema: { type: "object", properties: { reason: { type: "string", description: "Reason of completion" } }, required: ["reason"] },
  };
  const configuration = {
    orchestrationAIAgentConfiguration: {
      orchestrationAIPromptId: `${p.aiPromptId}:${pv.versionNumber}`,
      toolConfigurations: [...TOOLS.map((t) => agentToolConfiguration(t, toolIds[t.name])), complete],
      locale: "en_US",
      connectInstanceArn: C.INSTANCE_ARN,
    },
  };
  let a = await findByName((nextToken) => new Q.ListAIAgentsCommand({ assistantId, nextToken }), "aiAgentSummaries", C.AGENT);
  if (!a) {
    a = (await q.send(new Q.CreateAIAgentCommand({ assistantId, name: C.AGENT, type: "ORCHESTRATION", visibilityStatus: "PUBLISHED", configuration, tags: C.TAGS, description: "Burger ordering orchestrator" }))).aiAgent;
    console.log("agent: created", a.aiAgentId);
  } else {
    await q.send(new Q.UpdateAIAgentCommand({ assistantId, aiAgentId: a.aiAgentId, visibilityStatus: "PUBLISHED", configuration }));
    console.log("agent: updated", a.aiAgentId);
  }
  const av = await q.send(new Q.CreateAIAgentVersionCommand({ assistantId, aiAgentId: a.aiAgentId }));
  console.log("agent: version", av.versionNumber, "prompt version", pv.versionNumber);

  // The agent invokes flow-module tools under this security profile. The console (and, by every sign,
  // the tool runtime) reads the association from the `:$SAVED` agent ARN; one made on the bare ARN only
  // left the console showing "Insufficient" and tool calls failing with "Target entity not found".
  const base = `arn:aws:wisdom:${region}:${C.ACCOUNT}:ai-agent/${assistantId}/${a.aiAgentId}`;
  for (const agentArn of [base, `${base}:$SAVED`]) {
    const linked = await connect.send(new Connect.ListEntitySecurityProfilesCommand({ InstanceId: C.INSTANCE_ID, EntityType: "AI_AGENT", EntityArn: agentArn }));
    if (!linked.SecurityProfiles?.some((s) => s.Id === C.AI_SECURITY_PROFILE_ID)) {
      await connect.send(new Connect.AssociateSecurityProfilesCommand({ InstanceId: C.INSTANCE_ID, EntityType: "AI_AGENT", EntityArn: agentArn, SecurityProfiles: [{ Id: C.AI_SECURITY_PROFILE_ID }] }));
      console.log("agent: security profile associated", agentArn.slice(-45));
    }
  }
  await setDefaultAgent({ aiAgentId: a.aiAgentId, version: av.versionNumber });
  return { aiAgentId: a.aiAgentId, version: av.versionNumber };
}

/**
 * The AI conversation (Lex AMAZON.QInConnectIntent) uses the assistant's default orchestrator for the
 * Connect.SelfService use case, not the agent named in the flow's session block (found in the first
 * Phase 3 test chat, 2026-10-29). So the agent must also be that default.
 * It is set as `<id>:$LATEST`, as the console does: with a numbered version (`<id>:8`) every MCP tool call
 * failed with "Target entity not found", apparently because the security profile is linked to the agent's
 * unversioned/$LATEST/$SAVED ARNs but not to numbered versions.
 */
async function setDefaultAgent(v) {
  const { aiAgentId } = v ?? (await latestAgentVersion());
  await q.send(new Q.UpdateAssistantAIAgentCommand({
    assistantId: C.ASSISTANT_ID, aiAgentType: "ORCHESTRATION", orchestratorUseCase: "Connect.SelfService",
    configuration: { aiAgentId: `${aiAgentId}:$LATEST` },
  }));
  const a = (await q.send(new Q.GetAssistantCommand({ assistantId: C.ASSISTANT_ID }))).assistant;
  console.log("default orchestrator:", JSON.stringify(a.orchestratorConfigurationList ?? a.aiAgentConfiguration?.ORCHESTRATION));
}

async function latestAgentVersion() {
  const a = await findByName((nextToken) => new Q.ListAIAgentsCommand({ assistantId: C.ASSISTANT_ID, nextToken }), "aiAgentSummaries", C.AGENT);
  if (!a) throw new Error("Run the agent step first");
  const versions = (await q.send(new Q.ListAIAgentVersionsCommand({ assistantId: C.ASSISTANT_ID, aiAgentId: a.aiAgentId }))).aiAgentVersionSummaries ?? [];
  const version = Math.max(...versions.map((v) => v.versionNumber ?? 0));
  return { aiAgentId: a.aiAgentId, version };
}

function flowContent({ aiAgentId, version }) {
  const agentVersionArn = `arn:aws:wisdom:${region}:${C.ACCOUNT}:ai-agent/${C.ASSISTANT_ID}/${aiAgentId}:${version}`;
  return {
    Version: "2019-10-30",
    StartAction: "logging",
    Metadata: { entryPointPosition: { x: 20, y: 20 }, ActionMetadata: {}, Annotations: [] },
    Actions: [
      { Identifier: "logging", Type: "UpdateFlowLoggingBehavior", Parameters: { FlowLoggingBehavior: "Enabled" }, Transitions: { NextAction: "ai-session" } },
      // The console's "Connect assistant" block saves as this pair (read back from the Spike A flow).
      {
        Identifier: "ai-session",
        Type: "CreateWisdomSession",
        Parameters: { WisdomAssistantArn: C.ASSISTANT_ARN, OrchestrationAIAgentConfiguration: { AgentAssistanceAgentVersionArn: agentVersionArn } },
        Transitions: { NextAction: "store-session", Errors: [{ NextAction: "goodbye", ErrorType: "NoMatchingError" }] },
      },
      {
        Identifier: "store-session",
        Type: "UpdateContactData",
        Parameters: { WisdomSessionArn: "$.Wisdom.SessionArn" },
        Transitions: { NextAction: "init-cart", Errors: [{ NextAction: "goodbye", ErrorType: "NoMatchingError" }] },
      },
      // Links the contact to the website cart (signed widget attribute cartRef) and writes the first orderState.
      {
        Identifier: "init-cart",
        Type: "InvokeLambdaFunction",
        Parameters: {
          LambdaFunctionARN: lambdaArn,
          InvocationTimeLimitSeconds: "8",
          InvocationType: "SYNCHRONOUS",
          LambdaInvocationAttributes: { action: "init", cartRef: "$.Attributes.cartRef", channel: "$.Channel" },
          ResponseValidation: { ResponseType: "STRING_MAP" },
        },
        Transitions: { NextAction: "ai-agent", Errors: [{ NextAction: "ai-agent", ErrorType: "NoMatchingError" }] },
      },
      {
        Identifier: "ai-agent",
        Type: "ConnectParticipantWithLexBot",
        Parameters: { Text: "Hi! What can I get started for you today?", LexV2Bot: { AliasArn: C.LEX_BOT_ALIAS_ARN } },
        Transitions: {
          NextAction: "goodbye",
          Errors: [
            { NextAction: "goodbye", ErrorType: "NoMatchingCondition" },
            { NextAction: "goodbye", ErrorType: "NoMatchingError" },
          ],
        },
      },
      { Identifier: "goodbye", Type: "MessageParticipant", Parameters: { Text: "Thanks for chatting with us. Goodbye!" }, Transitions: { NextAction: "disconnect", Errors: [{ NextAction: "disconnect", ErrorType: "NoMatchingError" }] } },
      { Identifier: "disconnect", Type: "DisconnectParticipant", Parameters: {}, Transitions: {} },
    ],
  };
}

async function flow() {
  const Content = JSON.stringify(flowContent(await latestAgentVersion()));
  let NextToken, found;
  do {
    const r = await connect.send(new Connect.ListContactFlowsCommand({ InstanceId: C.INSTANCE_ID, ContactFlowTypes: ["CONTACT_FLOW"], NextToken }));
    found = r.ContactFlowSummaryList?.find((f) => f.Name === C.FLOW);
    NextToken = found ? undefined : r.NextToken;
  } while (NextToken);
  if (!found) {
    const r = await connect.send(new Connect.CreateContactFlowCommand({ InstanceId: C.INSTANCE_ID, Name: C.FLOW, Type: "CONTACT_FLOW", Content, Status: "PUBLISHED", Tags: C.TAGS, Description: "Burger ordering chat: AI session → cart link → AI agent" }));
    console.log("flow: created", r.ContactFlowId);
  } else {
    await connect.send(new Connect.UpdateContactFlowContentCommand({ InstanceId: C.INSTANCE_ID, ContactFlowId: found.Id, Content }));
    console.log("flow: updated", found.Id);
  }
}

async function status() {
  const out = {};
  try { out.table = (await ddb.send(new Ddb.DescribeTableCommand({ TableName: C.TABLE }))).Table?.TableStatus; } catch (e) { out.table = e.name; }
  try { out.lambda = (await lambda.send(new Lambda.GetFunctionCommand({ FunctionName: C.LAMBDA }))).Configuration?.State; } catch (e) { out.lambda = e.name; }
  for (const t of TOOLS) out[`module ${t.name}`] = (await findModule(`burger-tool-${t.name}`))?.Id ?? "missing";
  try { out.agent = await latestAgentVersion(); } catch (e) { out.agent = e.message; }
  console.log(JSON.stringify(out, null, 1));
}

const steps = { table, lambda: deployLambda, modules, agent, "default-agent": () => setDefaultAgent(), gateway, flow, status };
const step = process.argv[2];
if (!steps[step]) {
  console.error(`Usage: node infra/deploy/deploy.mjs <${Object.keys(steps).join("|")}>`);
  process.exit(1);
}
await steps[step]();
