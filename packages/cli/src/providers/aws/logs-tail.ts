import { CloudWatchLogsClient, FilterLogEventsCommand } from "@aws-sdk/client-cloudwatch-logs";

export async function tailLogs(logs: CloudWatchLogsClient, fnName: string, follow = false) {
  const logGroupName = `/aws/lambda/${fnName}`;
  // Start from now, not the past — a rerun must not replay the previous run's logs/errors.
  let startTime = Date.now();

  const printBatch = async () => {
    try {
      const r = await logs.send(new FilterLogEventsCommand({ logGroupName, startTime }));
      for (const e of r.events ?? []) {
        process.stdout.write(`[${fnName}] ${e.message ?? ""}`);
        if (e.timestamp) startTime = e.timestamp + 1;
      }
    } catch {}
  };

  await printBatch();

  if (follow) {
    const interval = setInterval(printBatch, 2000);
    process.on("SIGINT", () => {
      clearInterval(interval);
      process.exit(0);
    });
    await new Promise(() => {});
  }
}
