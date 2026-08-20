import { EventBridgeClient, PutRuleCommand, PutTargetsCommand } from "@aws-sdk/client-eventbridge";
import { LambdaClient, AddPermissionCommand } from "@aws-sdk/client-lambda";
import { asTagArray } from "./tags.js";
import type { AwsFnOutput } from "./functions.js";
import type { AppConfig } from "../../config.js";

// arn:aws:lambda:<region>:<account>:function:<name>
export const arnRegionAccount = (arn: string) => {
  const [, , , region, account] = arn.split(":");
  return { region, account };
};

// Convert 5-field unix cron to 6-field AWS cron
// EventBridge requires exactly one of dom/dow to be ? when both are wildcards
function toAwsCron(schedule: string): string {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return schedule;
  const [min, hour, dom, month, dow] = parts;
  const bothWild = dom === "*" && dow === "*";
  const awsDom = bothWild ? "*" : dow !== "*" ? "?" : dom;
  const awsDow = bothWild ? "?" : dom !== "*" ? "?" : dow;
  return `cron(${min} ${hour} ${awsDom} ${month} ${awsDow} *)`;
}

async function ensureRules(
  events: EventBridgeClient,
  lambda: LambdaClient,
  functions: AppConfig["functions"],
  fnOutputs: Record<string, AwsFnOutput>,
  appName: string,
  tags: Record<string, string>,
  kind: "cron" | "event",
) {
  for (const [fnName, fn] of Object.entries(functions ?? {})) {
    if (kind === "cron" ? !fn.cron : !fn.event) continue;
    const fnOutput = fnOutputs[fnName];
    // `-evt` suffix so an event rule never collides with a cron rule for the same function.
    const ruleName = kind === "event" ? `${appName}-${fnName}-evt` : `${appName}-${fnName}`;

    await events.send(
      new PutRuleCommand({
        Name: ruleName,
        ...(kind === "cron"
          ? { ScheduleExpression: toAwsCron(fn.cron!.schedule) }
          : { EventPattern: JSON.stringify(fn.event!.pattern) }),
        State: "ENABLED",
        Tags: asTagArray(tags),
      }),
    );

    await events.send(
      new PutTargetsCommand({
        Rule: ruleName,
        Targets: [{ Id: fnOutput.name, Arn: fnOutput.arn }],
      }),
    );

    try {
      const { region, account } = arnRegionAccount(fnOutput.arn);
      await lambda.send(
        new AddPermissionCommand({
          FunctionName: fnOutput.name,
          StatementId: `events-${ruleName}`,
          Action: "lambda:InvokeFunction",
          Principal: "events.amazonaws.com",
          SourceArn: `arn:aws:events:${region}:${account}:rule/${ruleName}`,
        }),
      );
    } catch (e: any) {
      if (e.name !== "ResourceConflictException") throw e;
    }
  }
}

// EventBridge event-pattern trigger: invoke the function when an event on the (default)
// bus matches `pattern`.
// ponytail: default bus only. Add `EventBusName` + a CreateEventBus get-or-create if a
// named bus is ever needed.
export function ensureEventTriggers(
  events: EventBridgeClient,
  lambda: LambdaClient,
  functions: AppConfig["functions"],
  fnOutputs: Record<string, AwsFnOutput>,
  appName: string,
  tags: Record<string, string>,
) {
  return ensureRules(events, lambda, functions, fnOutputs, appName, tags, "event");
}

export function ensureCronTriggers(
  events: EventBridgeClient,
  lambda: LambdaClient,
  functions: AppConfig["functions"],
  fnOutputs: Record<string, AwsFnOutput>,
  appName: string,
  tags: Record<string, string>,
) {
  return ensureRules(events, lambda, functions, fnOutputs, appName, tags, "cron");
}
