import {
  DynamoDBClient,
  CreateTableCommand,
  ScalarAttributeType,
  KeyType,
  BillingMode,
} from '@aws-sdk/client-dynamodb'
import { envKey } from '../../env-key.js'
import { asTagArray } from './tags.js'
import type { DynamoDbDef } from '../../config.js'

export async function ensureDynamoTables(
  dynamo: DynamoDBClient,
  tables: Record<string, DynamoDbDef>,
  appName: string,
  tags: Record<string, string>,
): Promise<Record<string, string>> {
  const envVars: Record<string, string> = {}

  for (const [name, cfg] of Object.entries(tables)) {
    const tableName = `${appName}-${name}`

    const attrDefs = [
      {
        AttributeName: cfg.partitionKey.name,
        AttributeType: cfg.partitionKey.type as ScalarAttributeType,
      },
    ]
    const keySchema = [{ AttributeName: cfg.partitionKey.name, KeyType: 'HASH' as KeyType }]

    if (cfg.sortKey) {
      attrDefs.push({
        AttributeName: cfg.sortKey.name,
        AttributeType: cfg.sortKey.type as ScalarAttributeType,
      })
      keySchema.push({ AttributeName: cfg.sortKey.name, KeyType: 'RANGE' as KeyType })
    }

    const gsis = cfg.gsi?.map((g) => {
      attrDefs.push({
        AttributeName: g.partitionKey.name,
        AttributeType: g.partitionKey.type as ScalarAttributeType,
      })
      const gsiKeys: { AttributeName: string; KeyType: KeyType }[] = [
        { AttributeName: g.partitionKey.name, KeyType: 'HASH' as KeyType },
      ]
      if (g.sortKey) {
        attrDefs.push({
          AttributeName: g.sortKey.name,
          AttributeType: g.sortKey.type as ScalarAttributeType,
        })
        gsiKeys.push({ AttributeName: g.sortKey.name, KeyType: 'RANGE' as KeyType })
      }
      return {
        IndexName: g.name,
        KeySchema: gsiKeys,
        Projection: { ProjectionType: 'ALL' as const },
      }
    })

    try {
      await dynamo.send(
        new CreateTableCommand({
          TableName: tableName,
          AttributeDefinitions: attrDefs.filter(
            (a, i, arr) => arr.findIndex((b) => b.AttributeName === a.AttributeName) === i,
          ),
          KeySchema: keySchema,
          BillingMode: BillingMode.PAY_PER_REQUEST,
          ...(gsis?.length ? { GlobalSecondaryIndexes: gsis } : {}),
          Tags: asTagArray(tags),
        }),
      )
    } catch (e: any) {
      if (e.name !== 'ResourceInUseException') throw e
    }

    envVars[envKey('DATABASE', name)] = tableName
  }

  return envVars
}
