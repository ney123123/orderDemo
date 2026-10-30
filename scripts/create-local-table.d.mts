import type { CreateTableCommandInput } from "@aws-sdk/client-dynamodb";
export declare function tableDefinition(TableName: string): CreateTableCommandInput;
export declare function createLocalTable(endpoint: string, tableName: string): Promise<"created" | "exists">;
