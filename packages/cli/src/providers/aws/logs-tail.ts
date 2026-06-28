import { CloudWatchLogsClient, FilterLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs'

export async function tailLogs(logs: CloudWatchLogsClient, fnName: string, follow = false) {
  const logGroupName = `/aws/lambda/${fnName}`
  let startTime = Date.now() - 60_000

  const printBatch = async () => {
    try {
      const r = await logs.send(new FilterLogEventsCommand({ logGroupName, startTime }))
      for (const e of r.events ?? []) {
        process.stdout.write(`[${fnName}] ${e.message ?? ''}`)
        if (e.timestamp) startTime = e.timestamp + 1
      }
    } catch {}
  }

  await printBatch()

  if (follow) {
    const interval = setInterval(printBatch, 2000)
    process.on('SIGINT', () => {
      clearInterval(interval)
      process.exit(0)
    })
    await new Promise(() => {})
  }
}
