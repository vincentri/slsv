import {
  CloudWatchLogsClient,
  CreateLogGroupCommand,
  PutRetentionPolicyCommand,
  DeleteRetentionPolicyCommand,
  DeleteLogGroupCommand,
  DescribeLogGroupsCommand,
} from "@aws-sdk/client-cloudwatch-logs";

export async function ensureLogGroup(
  logs: CloudWatchLogsClient,
  fnName: string,
  retentionDays: number,
): Promise<string> {
  const logGroupName = `/aws/lambda/${fnName}`;
  try {
    await logs.send(new CreateLogGroupCommand({ logGroupName }));
  } catch (e: any) {
    if (e.name !== "ResourceAlreadyExistsException") throw e;
  }
  // Applied on every deploy so a changed value takes effect. 0 = never expire (clear policy).
  if (retentionDays > 0) {
    await logs.send(
      new PutRetentionPolicyCommand({ logGroupName, retentionInDays: retentionDays }),
    );
  } else {
    await logs.send(new DeleteRetentionPolicyCommand({ logGroupName })).catch(() => {});
  }
  return logGroupName;
}

// List every Lambda log group under an app+stage prefix (full `/aws/lambda/<app>-<stage>-…`
// names), draining pages. Lets destroy sweep log groups by DISCOVERY — catching ORPHANS whose
// Lambda was already deleted (a pruned function, or a partial prior destroy), which a
// per-existing-function delete misses.
export async function listLambdaLogGroups(
  logs: CloudWatchLogsClient,
  prefix: string,
): Promise<string[]> {
  const names: string[] = [];
  let nextToken: string | undefined;
  do {
    const r = await logs.send(
      new DescribeLogGroupsCommand({ logGroupNamePrefix: `/aws/lambda/${prefix}`, nextToken }),
    );
    for (const g of r.logGroups ?? []) if (g.logGroupName) names.push(g.logGroupName);
    nextToken = r.nextToken;
  } while (nextToken);
  return names;
}

// Delete a function's log group on teardown so logs don't linger (and bill) after the
// Lambda is gone. No-op if it was never created.
export async function deleteLogGroup(logs: CloudWatchLogsClient, fnName: string): Promise<void> {
  await logs
    .send(new DeleteLogGroupCommand({ logGroupName: `/aws/lambda/${fnName}` }))
    .catch((e: any) => {
      if (e.name !== "ResourceNotFoundException") throw e;
    });
}
