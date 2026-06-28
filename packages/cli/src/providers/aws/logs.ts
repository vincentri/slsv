import { CloudWatchLogsClient, CreateLogGroupCommand } from '@aws-sdk/client-cloudwatch-logs'

export async function ensureLogGroup(logs: CloudWatchLogsClient, fnName: string): Promise<string> {
  const logGroupName = `/aws/lambda/${fnName}`
  try {
    await logs.send(new CreateLogGroupCommand({ logGroupName }))
  } catch (e: any) {
    if (e.name !== 'ResourceAlreadyExistsException') throw e
  }
  return logGroupName
}
