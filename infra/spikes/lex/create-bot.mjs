// Creates the Lex V2 bot that hands the conversation to the Connect AI agent (AMAZON.QInConnectIntent),
// builds it, publishes a version + alias, and associates the alias with the Connect instance.
import { LexModelsV2Client, CreateBotCommand, DescribeBotCommand, CreateBotLocaleCommand, DescribeBotLocaleCommand,
  CreateIntentCommand, BuildBotLocaleCommand, CreateBotVersionCommand, DescribeBotVersionCommand, CreateBotAliasCommand, ListBotsCommand, ListBotVersionsCommand } from "@aws-sdk/client-lex-models-v2";
import { ConnectClient, AssociateBotCommand } from "@aws-sdk/client-connect";
import { ACCOUNT as ACCT, ASSISTANT_ID, INSTANCE_ID, REGION as R } from "../../deploy/config.mjs";
const lex = new LexModelsV2Client({ region: R }), connect = new ConnectClient({ region: R });
const ASSISTANT_ARN = `arn:aws:wisdom:${R}:${ACCT}:assistant/${ASSISTANT_ID}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ok, label) => { for (let i = 0; i < 60; i++) { let s; try { s = await fn(); } catch (e) { if (e.name !== "ResourceNotFoundException") throw e; s = "Pending"; } if (ok(s)) return s; if (/Failed/.test(s)) throw new Error(`${label} ${s}`); await sleep(5000); } throw new Error(`${label} timeout`); };

let botId = (await lex.send(new ListBotsCommand({ filters: [{ name: "BotName", values: ["burger-spike-bot"], operator: "EQ" }] }))).botSummaries?.[0]?.botId;
if (!botId) {
  botId = (await lex.send(new CreateBotCommand({ botName: "burger-spike-bot", roleArn: `arn:aws:iam::${ACCT}:role/burger-lex-bot`,
    dataPrivacy: { childDirected: false }, idleSessionTTLInSeconds: 300, botTags: { project: "burger-order-demo" } }))).botId;
}
console.log("bot", botId);
await until(async () => (await lex.send(new DescribeBotCommand({ botId }))).botStatus, s => s === "Available", "bot");

try {
  await lex.send(new CreateBotLocaleCommand({ botId, botVersion: "DRAFT", localeId: "en_US", nluIntentConfidenceThreshold: 0.4,
    voiceSettings: { voiceId: "Joanna", engine: "neural" } }));
} catch (e) { if (!/already exists/i.test(e.message) && e.name !== "ConflictException" && e.name !== "PreconditionFailedException") throw e; }
await until(async () => (await lex.send(new DescribeBotLocaleCommand({ botId, botVersion: "DRAFT", localeId: "en_US" }))).botLocaleStatus,
  s => ["NotBuilt", "Built", "ReadyExpressTesting"].includes(s), "locale");

try {
  await lex.send(new CreateIntentCommand({ botId, botVersion: "DRAFT", localeId: "en_US", intentName: "AmazonConnectAIAgent",
    parentIntentSignature: "AMAZON.QInConnectIntent",
    qInConnectIntentConfiguration: { qInConnectAssistantConfiguration: { assistantArn: ASSISTANT_ARN } } }));
} catch (e) { if (!/already exists/.test(e.message) && e.name !== "ConflictException") throw e; console.log("intent exists"); }

await lex.send(new BuildBotLocaleCommand({ botId, botVersion: "DRAFT", localeId: "en_US" }));
await until(async () => (await lex.send(new DescribeBotLocaleCommand({ botId, botVersion: "DRAFT", localeId: "en_US" }))).botLocaleStatus, s => s === "Built", "build");
console.log("built");

let botVersion = (await lex.send(new ListBotVersionsCommand({ botId }))).botVersionSummaries?.map(v => v.botVersion).filter(v => v !== "DRAFT")[0];
if (!botVersion) ({ botVersion } = await lex.send(new CreateBotVersionCommand({ botId, botVersionLocaleSpecification: { en_US: { sourceBotVersion: "DRAFT" } } })));
await until(async () => (await lex.send(new DescribeBotVersionCommand({ botId, botVersion }))).botStatus, s => s === "Available", "version");
const alias = await lex.send(new CreateBotAliasCommand({ botId, botAliasName: "live", botVersion,
  botAliasLocaleSettings: { en_US: { enabled: true } }, tags: { project: "burger-order-demo" } }));
const aliasArn = `arn:aws:lex:${R}:${ACCT}:bot-alias/${botId}/${alias.botAliasId}`;
console.log("version", botVersion, "alias", aliasArn);
await sleep(5000);
await connect.send(new AssociateBotCommand({ InstanceId: INSTANCE_ID, LexV2Bot: { AliasArn: aliasArn } }));
console.log("associated with Connect");
