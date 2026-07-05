import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  QueryCommand,
  ScanCommand,
  BatchGetCommand,
  BatchWriteCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb'
import type { DbClient, Item, Key, QueryOptions } from '../../types.js'

// AWS_ENDPOINT_URL (injected by slsv) makes this hit Floci locally and
// real AWS in prod, with zero code change.
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}))

export function makeDb(tableName: string): DbClient {
  return {
    async get(key: Key) {
      const r = await doc.send(new GetCommand({ TableName: tableName, Key: key }))
      return r.Item
    },

    async put(item: Item) {
      await doc.send(new PutCommand({ TableName: tableName, Item: item }))
    },

    async delete(key: Key) {
      await doc.send(new DeleteCommand({ TableName: tableName, Key: key }))
    },

    async query(partition: Key, opts: QueryOptions = {}) {
      const [pkName, pkValue] = Object.entries(partition)[0]
      const names: Record<string, string> = { '#pk': pkName }
      const values: Record<string, any> = { ':pk': pkValue }
      let keyExpr = '#pk = :pk'

      if (opts.sort) {
        // Sort condition applies to the index's sort key; user supplies attr via partition? No —
        // for simplicity the sort attr name is provided alongside. Keep one sort attr keyed by 'sk'.
        const s = opts.sort
        names['#sk'] = (s as any).attr ?? 'sk'
        const compare: Record<'eq' | 'lt' | 'lte' | 'gt' | 'gte', string> = {
          eq: '=',
          lt: '<',
          lte: '<=',
          gt: '>',
          gte: '>=',
        }
        for (const op of Object.keys(compare) as (keyof typeof compare)[]) {
          const v = s[op]
          if (v === undefined) continue
          keyExpr += ` AND #sk ${compare[op]} :sk`
          values[':sk'] = v
          break
        }
        if (s.beginsWith !== undefined) {
          keyExpr += ' AND begins_with(#sk, :sk)'
          values[':sk'] = s.beginsWith
        }
      }

      const r = await doc.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: opts.index,
          KeyConditionExpression: keyExpr,
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
          Limit: opts.limit,
        }),
      )
      return r.Items ?? []
    },

    async scan() {
      const r = await doc.send(new ScanCommand({ TableName: tableName }))
      return r.Items ?? []
    },

    async batchGet(keys: Key[]) {
      if (!keys.length) return []
      const r = await doc.send(
        new BatchGetCommand({
          RequestItems: { [tableName]: { Keys: keys } },
        }),
      )
      return r.Responses?.[tableName] ?? []
    },

    async batchPut(items: Item[]) {
      if (!items.length) return
      // DynamoDB batch limit is 25/request
      for (let i = 0; i < items.length; i += 25) {
        const chunk = items.slice(i, i + 25)
        await doc.send(
          new BatchWriteCommand({
            RequestItems: { [tableName]: chunk.map((Item) => ({ PutRequest: { Item } })) },
          }),
        )
      }
    },

    async transactWrite(ops) {
      await doc.send(
        new TransactWriteCommand({
          TransactItems: ops.map((op) =>
            op.put
              ? { Put: { TableName: tableName, Item: op.put } }
              : { Delete: { TableName: tableName, Key: op.delete! } },
          ),
        }),
      )
    },
  }
}
