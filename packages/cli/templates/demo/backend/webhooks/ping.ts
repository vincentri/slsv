import { cache, queue, secret } from "@slsv/sdk";

export const handler = async (event: any) => {
  const provided = event.headers?.["x-webhook-secret"];
  if (provided !== (await secret("WEBHOOK_SECRET")))
    return { statusCode: 401, body: "Unauthorized" };

  const body = JSON.parse(event.body ?? "{}") as { code: string; url: string };
  await queue("clicks").send({ ...body, at: new Date().toISOString() });
  await cache("links").incr(`webhook:${body.code}`);

  return { statusCode: 200, body: "ok" };
};
