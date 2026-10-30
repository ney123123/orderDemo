import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.string().default("development"),
  REPOSITORY: z.enum(["memory", "dynamo"]).default("memory"),
  TABLE_NAME: z.string().optional(),
  AWS_REGION: z.string().default("ca-central-1"),
  // Vercel sets AWS_REGION to its own region and reserves the AWS_* key names, so a host like that
  // uses these instead. Locally, leave them unset and the default AWS credential chain applies.
  BURGER_AWS_REGION: z.string().optional(),
  BURGER_AWS_ACCESS_KEY_ID: z.string().optional(),
  BURGER_AWS_SECRET_ACCESS_KEY: z.string().optional(),
  /** Most chat/call starts per restaurant day (public demo cost cap). */
  DAILY_CHAT_LIMIT: z.coerce.number().int().min(0).default(50),
  /** Local DynamoDB only, e.g. http://localhost:8000. */
  DYNAMODB_ENDPOINT: z.string().url().optional(),
  CHAT_MODE: z.enum(["mock", "connect"]).default("mock"),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:3000"),
  // Admin settings are checked separately (adminConfig) so a mistake there disables admin login
  // with a clear reason instead of taking the customer site down.
  /** Connect Communications Widget (CHAT_MODE=connect), from the console's widget page. */
  CONNECT_WIDGET_SCRIPT_URL: z.string().url().optional(),
  CONNECT_WIDGET_ID: z.string().optional(),
  CONNECT_WIDGET_SNIPPET_ID: z.string().optional(),
  CONNECT_WIDGET_SECURITY_KEY: z.string().optional(),
  /** Q Connect assistant of the instance (not secret). Turns on the call transcript on the website. */
  CONNECT_ASSISTANT_ID: z.string().uuid().optional(),
  ADMIN_USERNAME: z.string().optional(),
  ADMIN_PASSWORD_HASH: z.string().optional(),
  SESSION_SECRET: z.string().optional(),
});

const HASH_FORMAT = /^scrypt:\d+:\d+:\d+:[\w-]+:[\w-]+$/;

/** Valid admin settings, or the reason admin login is off (never includes the secret values). */
function adminConfig(e: z.infer<typeof EnvSchema>) {
  const { ADMIN_USERNAME: username, ADMIN_PASSWORD_HASH: passwordHash, SESSION_SECRET: sessionSecret } = e;
  const missing = [!username && "ADMIN_USERNAME", !passwordHash && "ADMIN_PASSWORD_HASH", !sessionSecret && "SESSION_SECRET"].filter(Boolean);
  if (missing.length) return { problem: `${missing.join(", ")} not set.` };
  if (!HASH_FORMAT.test(passwordHash!)) {
    return { problem: 'ADMIN_PASSWORD_HASH is not in the expected format. It must be the whole line printed by "npm run hash-password", starting with "scrypt:".' };
  }
  if (sessionSecret!.length < 32) return { problem: "SESSION_SECRET must be at least 32 characters." };
  return { admin: { username: username!, passwordHash: passwordHash!, sessionSecret: sessionSecret! } };
}

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(env: Record<string, string | undefined> = process.env) {
  const e = EnvSchema.parse(Object.fromEntries(Object.entries(env).filter(([, v]) => v !== "")));
  const production = e.NODE_ENV === "production";
  if (e.REPOSITORY === "dynamo" && !e.TABLE_NAME) throw new Error("REPOSITORY=dynamo needs TABLE_NAME");
  if (production && e.REPOSITORY === "memory") throw new Error("REPOSITORY=memory is for local development only");
  const admin = adminConfig(e);
  const widget =
    e.CHAT_MODE === "connect" && e.CONNECT_WIDGET_SCRIPT_URL && e.CONNECT_WIDGET_ID && e.CONNECT_WIDGET_SNIPPET_ID && e.CONNECT_WIDGET_SECURITY_KEY
      ? { scriptUrl: e.CONNECT_WIDGET_SCRIPT_URL, widgetId: e.CONNECT_WIDGET_ID, snippetId: e.CONNECT_WIDGET_SNIPPET_ID, securityKey: e.CONNECT_WIDGET_SECURITY_KEY }
      : undefined;
  return {
    production,
    repository: e.REPOSITORY,
    tableName: e.TABLE_NAME,
    region: e.BURGER_AWS_REGION ?? e.AWS_REGION,
    /** Explicit keys only when both are set (never logged); otherwise the SDK's default chain. */
    awsCredentials:
      e.BURGER_AWS_ACCESS_KEY_ID && e.BURGER_AWS_SECRET_ACCESS_KEY
        ? { accessKeyId: e.BURGER_AWS_ACCESS_KEY_ID, secretAccessKey: e.BURGER_AWS_SECRET_ACCESS_KEY }
        : undefined,
    dailyChatLimit: e.DAILY_CHAT_LIMIT,
    dynamoEndpoint: e.DYNAMODB_ENDPOINT,
    chatMode: e.CHAT_MODE,
    /** §4: the local tool console is never available in production. */
    mockConsole: e.CHAT_MODE === "mock" && !production,
    publicBaseUrl: e.PUBLIC_BASE_URL,
    secureCookies: production || e.PUBLIC_BASE_URL.startsWith("https://"),
    /** Set only in connect mode with all four widget settings; the security key never leaves the server. */
    widget,
    /** Connect mode with a widget and an assistant id: the page shows the call transcript. */
    transcriptAssistantId: widget ? e.CONNECT_ASSISTANT_ID : undefined,
    admin: admin.admin,
    adminProblem: admin.problem,
  };
}
