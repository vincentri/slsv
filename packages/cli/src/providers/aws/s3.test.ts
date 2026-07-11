import { describe, it, expect, vi } from "vitest";

// Mock the S3 client so the test never touches AWS/Floci.
const send = vi.fn();
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn(function () { return { send }; }),
  CreateBucketCommand: vi.fn(function (i) { return { __cmd: "CreateBucket", ...i }; }),
  HeadBucketCommand: vi.fn(function (i) { return { __cmd: "HeadBucket", ...i }; }),
  PutBucketTaggingCommand: vi.fn(function (i) { return { __cmd: "PutBucketTagging", ...i }; }),
  PutPublicAccessBlockCommand: vi.fn(function (i) { return { __cmd: "PutPublicAccessBlock", ...i }; }),
  PutBucketPolicyCommand: vi.fn(function (i) { return { __cmd: "PutBucketPolicy", ...i }; }),
  PutBucketCorsCommand: vi.fn(function (i) { return { __cmd: "PutBucketCors", ...i }; }),
}));

import { ensureBuckets } from "./s3.js";

const S3 = { send } as any; // vi.fn mock object — ensureBuckets' S3Client param is unused

describe("ensureBuckets", () => {
  it("creates + tags a default bucket with no extra policy calls", async () => {
    send.mockReset();
    send.mockResolvedValue({});

    await ensureBuckets(S3, { uploads: {} }, "shop-dev", {});

    expect(send).toHaveBeenCalledWith({ __cmd: "HeadBucket", Bucket: "shop-dev-uploads" });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ Tagging: { TagSet: [] } }));
    // No policy / cors / publicAccessBlock when publicRead + cors are both unset
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ Policy: expect.anything() }));
    expect(send).not.toHaveBeenCalledWith(
      expect.objectContaining({ CORSConfiguration: expect.anything() }),
    );
  });

  it("applies publicRead policy + disables access blocks", async () => {
    send.mockReset();
    send.mockResolvedValue({});

    await ensureBuckets(S3, { public: { publicRead: true } }, "shop-dev", {});

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: false,
          IgnorePublicAcls: false,
          BlockPublicPolicy: false,
          RestrictPublicBuckets: false,
        },
      }),
    );
    const policyCall = send.mock.calls.find(
      ([c]) => typeof c?.Policy === "string" && c.Policy.includes("s3:GetObject"),
    );
    expect(policyCall).toBeTruthy();
    const policy = JSON.parse(policyCall![0].Policy);
    expect(policy.Statement[0]).toMatchObject({
      Effect: "Allow",
      Principal: "*",
      Action: "s3:GetObject",
      Resource: "arn:aws:s3:::shop-dev-public/*",
    });
  });

  it("applies CORS rule when origins are configured", async () => {
    send.mockReset();
    send.mockResolvedValue({});

    await ensureBuckets(S3, { uploads: { cors: ["https://app.example.com"] } }, "shop-dev", {});

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        CORSConfiguration: {
          CORSRules: [
            expect.objectContaining({
              AllowedOrigins: ["https://app.example.com"],
              AllowedMethods: expect.arrayContaining(["GET", "PUT", "POST", "HEAD"]),
            }),
          ],
        },
      }),
    );
  });

  it("skips public policy and CORS for default bucket even with no flags", async () => {
    send.mockReset();
    send.mockResolvedValue({});

    await ensureBuckets(S3, { private: {} }, "shop-dev", {});

    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ Policy: expect.anything() }));
    expect(send).not.toHaveBeenCalledWith(
      expect.objectContaining({ CORSConfiguration: expect.anything() }),
    );
  });

  it("skips CreateBucket when HeadBucket succeeds (bucket already exists)", async () => {
    send.mockReset();
    send.mockResolvedValue({});

    await ensureBuckets(S3, { uploads: {} }, "shop-dev", {});

    const createCalls = send.mock.calls.filter(([c]) => c?.__cmd === "CreateBucket");
    expect(createCalls).toHaveLength(0);
  });

  it("creates bucket when HeadBucket throws (bucket does not exist)", async () => {
    send.mockReset();
    send.mockRejectedValueOnce({ name: "NotFound" }).mockResolvedValue({});

    await ensureBuckets(S3, { uploads: {} }, "shop-dev", {});

    const createCalls = send.mock.calls.filter(([c]) => c?.__cmd === "CreateBucket");
    expect(createCalls).toEqual([[{ __cmd: "CreateBucket", Bucket: "shop-dev-uploads" }]]);
  });
});
