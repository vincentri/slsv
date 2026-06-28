import {
  IAMClient,
  CreateRoleCommand,
  AttachRolePolicyCommand,
  GetRoleCommand,
} from '@aws-sdk/client-iam'

const ROLE_NAME = 'slsv-lambda-exec'
const TRUST_POLICY = JSON.stringify({
  Version: '2012-10-17',
  Statement: [
    {
      Effect: 'Allow',
      Principal: { Service: 'lambda.amazonaws.com' },
      Action: 'sts:AssumeRole',
    },
  ],
})

export async function ensureExecRole(iam: IAMClient): Promise<string> {
  let arn: string
  try {
    const r = await iam.send(
      new CreateRoleCommand({
        RoleName: ROLE_NAME,
        AssumeRolePolicyDocument: TRUST_POLICY,
      }),
    )
    arn = r.Role!.Arn!
  } catch (e: any) {
    if (e.name !== 'EntityAlreadyExistsException') throw e
    const r = await iam.send(new GetRoleCommand({ RoleName: ROLE_NAME }))
    arn = r.Role!.Arn!
  }

  try {
    await iam.send(
      new AttachRolePolicyCommand({
        RoleName: ROLE_NAME,
        PolicyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
      }),
    )
  } catch (e: any) {
    // ponytail: SDK reports this as EntityAlreadyExistsException too — same family
    if (e.name !== 'EntityAlreadyExistsException') throw e
  }

  return arn
}
