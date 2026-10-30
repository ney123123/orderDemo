// Deletes leftover contract-test tables on AWS (names starting with "burger-test-" only).
// Usage: node scripts/delete-test-tables.mjs          (lists what it would delete)
//        node scripts/delete-test-tables.mjs --yes    (deletes them)
import { DeleteTableCommand, DynamoDBClient, paginateListTables } from "@aws-sdk/client-dynamodb";

const PREFIX = "burger-test-";
const db = new DynamoDBClient({ region: process.env.AWS_REGION ?? "ca-central-1" });
const names = [];
for await (const page of paginateListTables({ client: db }, {})) names.push(...(page.TableNames ?? []).filter((n) => n.startsWith(PREFIX)));
if (names.length === 0) console.log("No burger-test-* tables.");
for (const name of names) {
  if (!name.startsWith(PREFIX)) continue;
  if (process.argv.includes("--yes")) {
    await db.send(new DeleteTableCommand({ TableName: name }));
    console.log("deleting", name);
  } else console.log("would delete", name);
}
