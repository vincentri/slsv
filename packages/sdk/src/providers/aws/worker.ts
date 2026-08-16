import { ECSClient, RunTaskCommand } from "@aws-sdk/client-ecs";

// Shape slsv injects as WORKER_<NAME> (see cli providers/aws/workers.ts).
type WorkerSpec = {
  cluster: string;
  taskDefinition: string;
  container: string;
  subnets?: string[];
  securityGroups?: string[];
  assignPublicIp?: boolean;
};

export type WorkerClient = {
  /**
   * Launch one container task for this job and return immediately — the task runs on its own
   * and nothing bills once it exits. `payload` is passed as the container's `SLSV_PAYLOAD` env
   * var, so keep it small (ECS caps the whole overrides object near 8KB): send an id, and let
   * the worker fetch the data itself.
   */
  run(payload?: unknown): Promise<{ jobId: string }>;
};

// One client per container, like the other accessors.
let client: ECSClient | undefined;
const ecs = () => (client ??= new ECSClient({}));

export function makeWorker(specJson: string): WorkerClient {
  const spec: WorkerSpec = JSON.parse(specJson);
  return {
    async run(payload) {
      const body = JSON.stringify(payload ?? {});
      // ECS caps the whole overrides object near 8KB and reports it as a generic
      // InvalidParameterException — say what's actually wrong instead.
      if (body.length > 8000)
        throw new Error(
          `slsv: worker payload is ${body.length} bytes (ECS overrides cap is ~8KB). ` +
            `Pass an id and let the worker fetch the data itself.`,
        );
      const res = await ecs().send(
        new RunTaskCommand({
          cluster: spec.cluster,
          taskDefinition: spec.taskDefinition,
          launchType: "FARGATE",
          count: 1,
          // Floci ignores networking entirely, so the CLI leaves subnets unset locally and
          // RunTask still places the container. Fargate REQUIRES it on real AWS.
          ...(spec.subnets
            ? {
                networkConfiguration: {
                  awsvpcConfiguration: {
                    subnets: spec.subnets,
                    // .length, not truthiness: an empty array would be SENT, and RunTask rejects
                    // it — omitting the field is what falls back to the VPC default group.
                    ...(spec.securityGroups?.length ? { securityGroups: spec.securityGroups } : {}),
                    assignPublicIp: spec.assignPublicIp === false ? "DISABLED" : "ENABLED",
                  },
                },
              }
            : {}),
          overrides: {
            containerOverrides: [
              {
                name: spec.container,
                environment: [
                  { name: "SLSV_PAYLOAD", value: body },
                ],
              },
            ],
          },
        }),
      );
      const arn = res.tasks?.[0]?.taskArn;
      if (!arn) {
        const f = res.failures?.[0];
        throw new Error(`slsv: worker task failed to start${f ? `: ${f.reason}` : ""}`);
      }
      return { jobId: arn.split("/").pop()! };
    },
  };
}
