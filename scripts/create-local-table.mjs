// Creates the single table in DynamoDB Local (never AWS: refuses without a localhost endpoint).
// Usage: DYNAMODB_ENDPOINT=http://localhost:8000 TABLE_NAME=burger-local node scripts/create-local-table.mjs
import { CreateTableCommand, DynamoDBClient, ResourceInUseException } from "@aws-sdk/client-dynamodb";

export const tableDefinition = (TableName) => ({
  TableName,
  BillingMode: "PAY_PER_REQUEST",
  AttributeDefinitions: [
    { AttributeName: "pk", AttributeType: "S" },
    { AttributeName: "gsi1pk", AttributeType: "S" },
    { AttributeName: "gsi1sk", AttributeType: "S" },
  ],
  KeySchema: [{ AttributeName: "pk", KeyType: "HASH" }],
  GlobalSecondaryIndexes: [
    {
      IndexName: "byStatus",
      KeySchema: [
        { AttributeName: "gsi1pk", KeyType: "HASH" },
        { AttributeName: "gsi1sk", KeyType: "RANGE" },
      ],
      Projection: { ProjectionType: "ALL" },
    },
  ],
});

export async function createLocalTable(endpoint, tableName) {
  if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(endpoint)) throw new Error(`Refusing non-local endpoint ${endpoint}`);
  const db = new DynamoDBClient({ endpoint, region: "local", credentials: { accessKeyId: "local", secretAccessKey: "local" } });
  try {
    await db.send(new CreateTableCommand(tableDefinition(tableName)));
    return "created";
  } catch (e) {
    if (e instanceof ResourceInUseException) return "exists";
    throw e;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { DYNAMODB_ENDPOINT, TABLE_NAME = "burger-local" } = process.env;
  if (!DYNAMODB_ENDPOINT) throw new Error("Set DYNAMODB_ENDPOINT (e.g. http://localhost:8000)");
  console.log(TABLE_NAME, await createLocalTable(DYNAMODB_ENDPOINT, TABLE_NAME));
}
