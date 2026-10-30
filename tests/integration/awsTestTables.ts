import {
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  waitUntilTableExists,
} from "@aws-sdk/client-dynamodb";
import { tableDefinition } from "../../scripts/create-local-table.mjs";

// Short-lived test tables on real AWS (opt-in: DYNAMODB_AWS_TEST=1). Every name starts with
// TEST_PREFIX, and create/delete refuse anything else, so other tables in the account are never touched.
export const TEST_PREFIX = "burger-test-";
const guard = (name: string) => {
  if (!name.startsWith(TEST_PREFIX)) throw new Error(`Refusing to touch non-test table ${name}`);
};

export function awsClient(region = process.env.AWS_REGION ?? "ca-central-1") {
  return new DynamoDBClient({ region });
}

export async function createTestTables(db: DynamoDBClient, count: number): Promise<string[]> {
  const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const names = Array.from({ length: count }, (_, i) => `${TEST_PREFIX}${run}-${i}`);
  await Promise.all(
    names.map(async (name) => {
      guard(name);
      await db.send(
        new CreateTableCommand({
          ...tableDefinition(name),
          Tags: [
            { Key: "project", Value: "burger-order-demo" },
            { Key: "purpose", Value: "contract-test" },
          ],
        }),
      );
      await waitUntilTableExists({ client: db, maxWaitTime: 180 }, { TableName: name });
      // The GSI must be ACTIVE too before queries against it are reliable.
      for (let i = 0; i < 60; i++) {
        const t = await db.send(new DescribeTableCommand({ TableName: name }));
        if (t.Table?.GlobalSecondaryIndexes?.every((g) => g.IndexStatus === "ACTIVE")) return;
        await new Promise((r) => setTimeout(r, 2000));
      }
      throw new Error(`GSI on ${name} did not become ACTIVE`);
    }),
  );
  return names;
}

export async function deleteTestTables(db: DynamoDBClient, names: string[]): Promise<void> {
  await Promise.all(
    names.map(async (name) => {
      guard(name);
      try {
        await db.send(new DeleteTableCommand({ TableName: name }));
      } catch (e) {
        if (!(e instanceof Error && e.name === "ResourceNotFoundException")) throw e;
      }
    }),
  );
}
