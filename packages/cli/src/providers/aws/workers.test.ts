import { describe, it, expect } from "vitest";
import type { EC2Client } from "@aws-sdk/client-ec2";
import { resolveDefaultVpc } from "./workers.js";
import { ConfigError } from "../../config.js";

// Default-VPC discovery is the one worker path Floci can't exercise at all — it has no EC2 API,
// so this branch's first real run would otherwise be a live AWS deploy. Faked client, real logic.
const fakeEc2 = (handlers: Record<string, unknown>, log: string[] = []) =>
  ({
    send: async (cmd: { constructor: { name: string } }) => {
      const name = cmd.constructor.name;
      log.push(name);
      if (!(name in handlers)) throw new Error(`unexpected command ${name}`);
      return handlers[name];
    },
  }) as unknown as EC2Client;

describe("resolveDefaultVpc", () => {
  it("returns the default VPC's subnets and reuses an existing security group", async () => {
    const log: string[] = [];
    const net = await resolveDefaultVpc(
      fakeEc2(
        {
          DescribeSubnetsCommand: {
            Subnets: [
              { SubnetId: "subnet-a", VpcId: "vpc-1" },
              { SubnetId: "subnet-b", VpcId: "vpc-1" },
            ],
          },
          DescribeSecurityGroupsCommand: { SecurityGroups: [{ GroupId: "sg-existing" }] },
        },
        log,
      ),
      "shop-dev",
      {},
    );
    expect(net).toEqual({ subnets: ["subnet-a", "subnet-b"], securityGroups: ["sg-existing"] });
    expect(log).not.toContain("CreateSecurityGroupCommand"); // idempotent — no duplicate SG
  });

  it("creates the egress-only security group when it doesn't exist yet", async () => {
    const log: string[] = [];
    const net = await resolveDefaultVpc(
      fakeEc2(
        {
          DescribeSubnetsCommand: { Subnets: [{ SubnetId: "subnet-a", VpcId: "vpc-1" }] },
          DescribeSecurityGroupsCommand: { SecurityGroups: [] },
          CreateSecurityGroupCommand: { GroupId: "sg-new" },
        },
        log,
      ),
      "shop-dev",
      {},
    );
    expect(net.securityGroups).toEqual(["sg-new"]);
    expect(log).toContain("CreateSecurityGroupCommand");
  });

  it("throws a ConfigError naming the override when the account has no default VPC", async () => {
    await expect(
      resolveDefaultVpc(fakeEc2({ DescribeSubnetsCommand: { Subnets: [] } }), "shop-dev", {}),
    ).rejects.toThrow(ConfigError);
    await expect(
      resolveDefaultVpc(fakeEc2({ DescribeSubnetsCommand: { Subnets: [] } }), "shop-dev", {}),
    ).rejects.toThrow(/workers\.<name>\.vpc/);
  });
});
