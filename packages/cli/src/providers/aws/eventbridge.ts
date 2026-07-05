import { EventBridgeClient, PutRuleCommand, PutTargetsCommand } from '@aws-sdk/client-eventbridge'
import { LambdaClient, AddPermissionCommand } from '@aws-sdk/client-lambda'
import { asTagArray } from './tags.js'
import type { AwsFnOutput } from './functions.js'
import type { AppConfig } from '../../config.js'

// Convert 5-field unix cron to 6-field AWS cron
// EventBridge requires exactly one of dom/dow to be ? when both are wildcards
function toAwsCron(schedule: string): string {
  const parts = schedule.trim().split(/\s+/)
  if (parts.length !== 5) return schedule
  const [min, hour, dom, month, dow] = parts
  const bothWild = dom === '*' && dow === '*'
  const awsDom = bothWild ? '*' : dow !== '*' ? '?' : dom
  const awsDow = bothWild ? '?' : dom !== '*' ? '?' : dow
  return `cron(${min} ${hour} ${awsDom} ${month} ${awsDow} *)`
}

// EventBridge event-pattern trigger: invoke the function when an event on the (default)
// bus matches `pattern`. Mirrors ensureCronTriggers but with EventPattern, not a schedule.
// ponytail: default bus only. Add `EventBusName` + a CreateEventBus get-or-create if a
// named bus is ever needed.
export async function ensureEventTriggers(
  events: EventBridgeClient,
  lambda: LambdaClient,
  functions: AppConfig['functions'],
  fnOutputs: Record<string, AwsFnOutput>,
  appName: string,
  tags: Record<string, string>,
) {
  for (const [fnName, fn] of Object.entries(functions ?? {})) {
    if (!fn.event) continue
    const fnOutput = fnOutputs[fnName]
    // `-evt` suffix so an event rule never collides with a cron rule for the same function.
    const ruleName = `${appName}-${fnName}-evt`

    await events.send(
      new PutRuleCommand({
        Name: ruleName,
        EventPattern: JSON.stringify(fn.event.pattern),
        State: 'ENABLED',
        Tags: asTagArray(tags),
      }),
    )

    await events.send(
      new PutTargetsCommand({
        Rule: ruleName,
        Targets: [{ Id: fnOutput.name, Arn: fnOutput.arn }],
      }),
    )

    try {
      await lambda.send(
        new AddPermissionCommand({
          FunctionName: fnOutput.name,
          StatementId: `events-${ruleName}`,
          Action: 'lambda:InvokeFunction',
          Principal: 'events.amazonaws.com',
          SourceArn: `arn:aws:events:${fnOutput.arn.split(':')[3]}:${fnOutput.arn.split(':')[4]}:rule/${ruleName}`,
        }),
      )
    } catch (e: any) {
      if (e.name !== 'ResourceConflictException') throw e
    }
  }
}

export async function ensureCronTriggers(
  events: EventBridgeClient,
  lambda: LambdaClient,
  functions: AppConfig['functions'],
  fnOutputs: Record<string, AwsFnOutput>,
  appName: string,
  tags: Record<string, string>,
) {
  for (const [fnName, fn] of Object.entries(functions ?? {})) {
    if (!fn.cron) continue
    const fnOutput = fnOutputs[fnName]
    const ruleName = `${appName}-${fnName}`

    await events.send(
      new PutRuleCommand({
        Name: ruleName,
        ScheduleExpression: toAwsCron(fn.cron.schedule),
        State: 'ENABLED',
        Tags: asTagArray(tags),
      }),
    )

    await events.send(
      new PutTargetsCommand({
        Rule: ruleName,
        Targets: [{ Id: fnOutput.name, Arn: fnOutput.arn }],
      }),
    )

    try {
      await lambda.send(
        new AddPermissionCommand({
          FunctionName: fnOutput.name,
          StatementId: `events-${ruleName}`,
          Action: 'lambda:InvokeFunction',
          Principal: 'events.amazonaws.com',
          SourceArn: `arn:aws:events:${fnOutput.arn.split(':')[3]}:${fnOutput.arn.split(':')[4]}:rule/${ruleName}`,
        }),
      )
    } catch (e: any) {
      if (e.name !== 'ResourceConflictException') throw e
    }
  }
}
