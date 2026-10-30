import { join } from "node:path";
import { AdminService } from "../domain/admin/service";
import { CartService } from "../domain/cart/service";
import { createToolHandlers } from "../domain/tools/handlers";
import { QConnectClient } from "@aws-sdk/client-qconnect";
import { AdminAuth } from "../auth/adminAuth";
import { QConnectTranscript } from "../connect/transcript/qconnectTranscript";
import { createAdminApi } from "../http/adminApi";
import { createCustomerApi } from "../http/customerApi";
import { loadStateTemplates } from "../prompts/loadStateTemplates";
import { DynamoRepository } from "../repositories/dynamo/dynamoRepository";
import { MemoryRepository } from "../repositories/memory/memoryRepository";
import type { Repository } from "../repositories/repository";
import { loadConfig, type AppConfig } from "./config";

export function buildContainer(config: AppConfig, opts: { repo?: Repository; now?: () => Date; templatesDir?: string } = {}) {
  const now = opts.now ?? (() => new Date());
  const repo =
    opts.repo ??
    (config.repository === "dynamo"
      ? new DynamoRepository({
          tableName: config.tableName!,
          client: {
            region: config.region,
            ...(config.awsCredentials ? { credentials: config.awsCredentials } : {}),
            ...(config.dynamoEndpoint ? { endpoint: config.dynamoEndpoint } : {}),
          },
        })
      : new MemoryRepository());
  const service = new CartService({ repo, now });
  const admin = new AdminService({ repo, now });
  const auth = new AdminAuth(config.admin, now, process.env.NODE_ENV !== "development");
  const templates = loadStateTemplates(opts.templatesDir ?? join(process.cwd(), "prompts/states"));
  const tools = createToolHandlers({ service, repo, templates, statusUrlBase: config.publicBaseUrl, now });
  const allowedOrigins = [new URL(config.publicBaseUrl).origin];
  const transcripts = config.transcriptAssistantId
    ? new QConnectTranscript({
        assistantId: config.transcriptAssistantId,
        client: new QConnectClient({ region: config.region, ...(config.awsCredentials ? { credentials: config.awsCredentials } : {}) }),
      })
    : undefined;
  return {
    config,
    repo,
    service,
    admin,
    auth,
    tools,
    templates,
    customerApi: createCustomerApi({ service, repo, tools, mockConsole: config.mockConsole, secureCookies: config.secureCookies, allowedOrigins, widget: config.widget, dailyChatLimit: config.dailyChatLimit, transcripts, now }),
    adminApi: createAdminApi({ admin, auth, repo, secureCookies: config.secureCookies, allowedOrigins }),
  };
}
export type Container = ReturnType<typeof buildContainer>;

// One container per server process; kept on globalThis so Next dev hot reloads don't wipe the memory repo.
const g = globalThis as { __burgerContainer?: Container };
export function container(): Container {
  if (!g.__burgerContainer) {
    const config = loadConfig();
    if (config.adminProblem) console.warn(`[config] Admin login is off: ${config.adminProblem}`);
    g.__burgerContainer = buildContainer(config);
  }
  return g.__burgerContainer;
}
