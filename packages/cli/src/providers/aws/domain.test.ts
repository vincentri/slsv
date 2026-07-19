import { describe, it, expect, vi, beforeEach } from "vitest";

// Cloudflare does real fetch — stub it out. cfZoneIdForDomain must resolve so teardown proceeds.
vi.mock("./cloudflare.js", () => ({
  cfZoneIdForDomain: vi.fn(async () => "zone1"),
  cfUpsertCname: vi.fn(async () => {}),
  cfDeleteByName: vi.fn(async () => {}),
}));

import { ensureApiDomain, destroyApiDomain } from "./domain.js";

// Minimal stateful fake of the AWS SDK send() interface. Dispatches on the command class name and
// mutates in-memory mapping state so a delete is visible to the next GetApiMappings.
type Mapping = { ApiId: string; ApiMappingId: string; ApiMappingKey?: string };

function fakeApigw(state: {
  apis: { Name: string; ApiId: string }[];
  domainMappings: Record<string, Mapping[]>;
  target?: string;
}) {
  const calls: { name: string; input: any }[] = [];
  const send = async (cmd: any) => {
    const name = cmd.constructor.name;
    const input = cmd.input;
    calls.push({ name, input });
    switch (name) {
      case "GetApisCommand":
        return { Items: state.apis };
      case "GetDomainNameCommand":
        return {
          DomainNameConfigurations: [{ ApiGatewayDomainName: state.target ?? "d-abc.execute-api.local" }],
        };
      case "CreateDomainNameCommand":
        return {};
      case "GetDomainNamesCommand":
        return { Items: Object.keys(state.domainMappings).map((DomainName) => ({ DomainName })) };
      case "GetApiMappingsCommand":
        return { Items: state.domainMappings[input.DomainName] ?? [] };
      case "CreateApiMappingCommand":
        (state.domainMappings[input.DomainName] ??= []).push({
          ApiId: input.ApiId,
          ApiMappingId: `m-${Math.floor(calls.length)}`,
          ApiMappingKey: input.ApiMappingKey,
        });
        return {};
      case "DeleteApiMappingCommand":
        state.domainMappings[input.DomainName] = (state.domainMappings[input.DomainName] ?? []).filter(
          (m) => m.ApiMappingId !== input.ApiMappingId,
        );
        return {};
      case "DeleteDomainNameCommand":
        delete state.domainMappings[input.DomainName];
        return {};
      default:
        return {};
    }
  };
  return { send, calls } as any;
}

function fakeAcm(domain = "shared.example.com") {
  const calls: { name: string; input: any }[] = [];
  const send = async (cmd: any) => {
    const name = cmd.constructor.name;
    calls.push({ name, input: cmd.input });
    switch (name) {
      case "ListCertificatesCommand":
        return { CertificateSummaryList: [{ DomainName: domain, CertificateArn: "arn:cert" }] };
      case "DescribeCertificateCommand":
        return {
          Certificate: { DomainValidationOptions: [{ ResourceRecord: { Name: "_x.shared.example.com." } }] },
        };
      case "DeleteCertificateCommand":
        return {};
      default:
        return {};
    }
  };
  return { send, calls } as any;
}

const has = (client: any, name: string) => client.calls.some((c: any) => c.name === name);
const find = (client: any, name: string) => client.calls.find((c: any) => c.name === name);

beforeEach(() => vi.clearAllMocks());

describe("ensureApiDomain — base-path mapping", () => {
  it("creates the mapping with ApiMappingKey = basePath", async () => {
    const apigw = fakeApigw({ apis: [{ Name: "auth", ApiId: "a" }], domainMappings: {} });
    await ensureApiDomain(apigw, fakeAcm(), { domain: "shared.example.com", basePath: "auth", certArn: "arn:byo" }, "auth");
    expect(find(apigw, "CreateApiMappingCommand").input.ApiMappingKey).toBe("auth");
  });

  it("root mapping (no basePath) → ApiMappingKey undefined", async () => {
    const apigw = fakeApigw({ apis: [{ Name: "solo", ApiId: "s" }], domainMappings: {} });
    await ensureApiDomain(apigw, fakeAcm(), { domain: "solo.example.com", certArn: "arn:byo" }, "solo");
    expect(find(apigw, "CreateApiMappingCommand").input.ApiMappingKey).toBeUndefined();
  });

  it("re-keys in place when basePath changed for this app", async () => {
    const apigw = fakeApigw({
      apis: [{ Name: "auth", ApiId: "a" }],
      domainMappings: { "shared.example.com": [{ ApiId: "a", ApiMappingId: "old", ApiMappingKey: "authv1" }] },
    });
    await ensureApiDomain(apigw, fakeAcm(), { domain: "shared.example.com", basePath: "auth", certArn: "arn:byo" }, "auth");
    expect(find(apigw, "DeleteApiMappingCommand").input.ApiMappingId).toBe("old");
    expect(find(apigw, "CreateApiMappingCommand").input.ApiMappingKey).toBe("auth");
  });
});

describe("destroyApiDomain — shared domain", () => {
  it("CRITICAL: keeps the domain + cert when a sibling app is still mapped", async () => {
    const apigw = fakeApigw({
      apis: [{ Name: "auth", ApiId: "a" }, { Name: "qualify", ApiId: "q" }],
      domainMappings: {
        "shared.example.com": [
          { ApiId: "a", ApiMappingId: "ma" },
          { ApiId: "q", ApiMappingId: "mq" },
        ],
      },
    });
    const acm = fakeAcm();
    await destroyApiDomain(apigw, acm, { domain: "shared.example.com" }, "auth");

    // Only auth's mapping deleted; qualify's survives.
    expect(find(apigw, "DeleteApiMappingCommand").input.ApiMappingId).toBe("ma");
    expect(apigw.calls.filter((c: any) => c.name === "DeleteApiMappingCommand")).toHaveLength(1);
    // The shared resources are untouched.
    expect(has(apigw, "DeleteDomainNameCommand")).toBe(false);
    expect(has(acm, "DeleteCertificateCommand")).toBe(false);
  });

  it("last app out → deletes mapping AND domain + cert", async () => {
    const apigw = fakeApigw({
      apis: [{ Name: "auth", ApiId: "a" }],
      domainMappings: { "shared.example.com": [{ ApiId: "a", ApiMappingId: "ma" }] },
    });
    const acm = fakeAcm();
    await destroyApiDomain(apigw, acm, { domain: "shared.example.com" }, "auth");

    expect(find(apigw, "DeleteApiMappingCommand").input.ApiMappingId).toBe("ma");
    expect(has(apigw, "DeleteDomainNameCommand")).toBe(true);
    expect(has(acm, "DeleteCertificateCommand")).toBe(true);
  });

  it("single-app (no appName) → full teardown, unchanged behavior", async () => {
    const apigw = fakeApigw({ apis: [], domainMappings: { "solo.example.com": [] } });
    const acm = fakeAcm("solo.example.com");
    await destroyApiDomain(apigw, acm, { domain: "solo.example.com" });
    expect(has(apigw, "DeleteDomainNameCommand")).toBe(true);
    expect(has(acm, "DeleteCertificateCommand")).toBe(true);
  });
});
