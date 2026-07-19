# Queues & Events

slsv wires three async trigger types: **SQS queues** (`queue:`), **EventBridge schedules** (`cron:`), and **EventBridge event-pattern rules** (`event:`). All three are wired through their native AWS APIs against Floci locally and real AWS in prod.

## SQS queues

```yaml
functions:
  worker:
    handler: ./src/worker.handler
    queue:
      name: jobs              # must match a declared queues.<name>

queues:
  jobs:
    type: sqs
    fifo: false               # default false; fifo: true → <name>.fifo
    visibilityTimeout: 60     # seconds
    dlq: jobsFailed           # optional; logical name of a declared queue
```

The trigger is an **SQS event-source mapping** (`ensureEventSourceMappings` in `eventsource.ts`). The function gets the queue URL as `QUEUE_JOBS` and uses `queue('jobs')` in the SDK.

### DLQ

`dlq: <name>` (logical name of another queue) wires a dead-letter target. `dlq: true` short-hand means `${queueName}Failed`. Lint checks: `dlq:` must name a declared queue.

### Per-message delay

`queue().send(body, { delaySeconds })` maps to SQS `DelaySeconds` (0–900). **FIFO queues reject per-message delay** — set it on the queue instead.

```ts
import { queue } from "@slsv/sdk";
await queue("jobs").send({ orderId: 123 }, { delaySeconds: 60 });
```

## EventBridge schedules (`cron:`)

```yaml
functions:
  dailyReport:
    handler: ./src/daily-report.handler
    cron:
      schedule: cron(0 8 * * ? *)   # EventBridge cron expression
```

Wired via `ensureCronTriggers` (`eventbridge.ts`). Rule name: `<app>-<stage>-<fn>`.

Reconcile sweeps these: a rule whose trigger (or whole function) was removed from the yml is pruned. Targets are cleared first — AWS refuses `DeleteRule` while targets exist.

## EventBridge event patterns (`event:`)

```yaml
functions:
  onUserSignup:
    handler: ./src/on-signup.handler
    event:
      pattern:
        source: ["myapp.users"]
        detail-type: ["User Created"]
```

Default bus. Wires an event-pattern rule via `ensureEventTriggers` (`eventbridge.ts`). Rule name: `<app>-<stage>-<fn>-evt`.

```ts
// app code — put an event onto the default bus to test
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";

await eb.send(new PutEventsCommand({
  Entries: [{
    Source: "myapp.users",
    DetailType: "User Created",
    Detail: JSON.stringify({ userId: "u_123" }),
    EventBusName: "default",
  }],
}));
```

## Stage-overlay trigger swap

A common pattern: dev uses an event-pattern rule (easy to fire manually); prod uses the SQS queue (durable). The `stages:` overlay's `null`-removes-key rule swaps them cleanly:

```yaml
functions:
  worker:
    handler: ./src/worker.handler
    queue: { name: jobs }     # base = prod default
    event:                    # dev-only event trigger
      pattern:
        source: [myapp.jobs]

stages:
  dev:
    functions:
      worker:
        queue: null           # remove queue trigger for dev
        # event: stays from base
```

See [Stages & targets](../architecture/stages.md) for the merge mechanics.

## Reconcile

| Removed from yml | Action |
|------------------|--------|
| Function (with any trigger) | Lambda pruned + ESM/rule swept |
| Just the trigger | Function kept, rule pruned |
| Just the queue block | Queue reported `orphan` — `slsv destroy` to remove |

`slsv destroy` (separate from reconcile) is discovery-based and tears down queues by prefix match.