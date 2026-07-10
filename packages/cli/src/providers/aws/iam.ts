import {
  IAMClient,
  CreateRoleCommand,
  AttachRolePolicyCommand,
  PutRolePolicyCommand,
  GetRoleCommand,
  DetachRolePolicyCommand,
  DeleteRolePolicyCommand,
  DeleteRoleCommand,
} from "@aws-sdk/client-iam";
import { asTagArray } from "./tags.js";

const BASIC_EXEC_ARN = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole";

const errName = (e: unknown) => (e as { name?: string }).name;

const TRUST_POLICY = JSON.stringify({
  Version: "2012-10-17",
  Statement: [
    {
      Effect: "Allow",
      Principal: { Service: "lambda.amazonaws.com" },
      Action: "sts:AssumeRole",
    },
  ],
});

// Inline policy granting the data actions functions need, scoped to THIS app+stage's
// resources (all named `${appName}-*`) — so a function can't touch another app/stage.
// ponytail: app+stage-scoped, not per-function. slsv injects every binding into every
// function, so there's no per-function resource list to narrow further. True per-function
// least-priv needs a `uses:` declaration in slsv.yml — future work.
function dataPolicy(appName: string): string {
  return JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
          "dynamodb:Scan",
          "dynamodb:BatchGetItem",
          "dynamodb:BatchWriteItem",
        ],
        Resource: [
          `arn:aws:dynamodb:*:*:table/${appName}-*`,
          `arn:aws:dynamodb:*:*:table/${appName}-*/index/*`,
        ],
      },
      {
        Effect: "Allow",
        Action: [
          "sqs:SendMessage",
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
          "sqs:GetQueueUrl",
        ],
        Resource: `arn:aws:sqs:*:*:${appName}-*`,
      },
      {
        Effect: "Allow",
        Action: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"],
        Resource: [`arn:aws:s3:::${appName}-*`, `arn:aws:s3:::${appName}-*/*`],
      },
      {
        Effect: "Allow",
        Action: "secretsmanager:GetSecretValue",
        Resource: `arn:aws:secretsmanager:*:*:secret:${appName}-*`,
      },
      {
        // X-Ray tracing (functions with `tracing: true`) — not resource-scopable.
        Effect: "Allow",
        Action: ["xray:PutTraceSegments", "xray:PutTelemetryRecords"],
        Resource: "*",
      },
    ],
  });
}

export async function ensureExecRole(
  iam: IAMClient,
  appName: string,
  tags: Record<string, string>,
): Promise<string> {
  const roleName = `${appName}-exec`;
  let arn: string;
  try {
    const r = await iam.send(
      new CreateRoleCommand({
        RoleName: roleName,
        AssumeRolePolicyDocument: TRUST_POLICY,
        Tags: asTagArray(tags),
      }),
    );
    arn = r.Role!.Arn!;
  } catch (e) {
    if (errName(e) !== "EntityAlreadyExistsException") throw e;
    const r = await iam.send(new GetRoleCommand({ RoleName: roleName }));
    arn = r.Role!.Arn!;
  }

  try {
    await iam.send(new AttachRolePolicyCommand({ RoleName: roleName, PolicyArn: BASIC_EXEC_ARN }));
  } catch (e) {
    if (errName(e) !== "EntityAlreadyExistsException") throw e;
  }

  // Inline data policy — idempotent (PutRolePolicy overwrites by name).
  await iam.send(
    new PutRolePolicyCommand({
      RoleName: roleName,
      PolicyName: "slsv-data",
      PolicyDocument: dataPolicy(appName),
    }),
  );

  return arn;
}

// Tear down the per-app+stage exec role: detach managed policy, delete the inline policy,
// delete the role. Each step tolerates "already gone" so destroy is idempotent.
export async function deleteExecRole(iam: IAMClient, appName: string): Promise<void> {
  const roleName = `${appName}-exec`;
  const ignore = (e: unknown) => {
    if (errName(e) !== "NoSuchEntity" && errName(e) !== "NoSuchEntityException") throw e;
  };
  await iam
    .send(new DetachRolePolicyCommand({ RoleName: roleName, PolicyArn: BASIC_EXEC_ARN }))
    .catch(ignore);
  await iam
    .send(new DeleteRolePolicyCommand({ RoleName: roleName, PolicyName: "slsv-data" }))
    .catch(ignore);
  await iam.send(new DeleteRoleCommand({ RoleName: roleName })).catch(ignore);
}
