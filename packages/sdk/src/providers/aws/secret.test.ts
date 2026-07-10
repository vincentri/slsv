import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the SM client so the test never touches AWS/Floci.
// vi.hoisted: vi.mock is hoisted above normal consts, so `send` must be too.
const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@aws-sdk/client-secrets-manager", () => ({
  SecretsManagerClient: vi.fn(() => ({ send })),
  GetSecretValueCommand: vi.fn((input) => input),
}));

import { getSecret } from "./secret.js";

describe("getSecret", () => {
  beforeEach(() => send.mockReset());

  it("fetches the value once and caches it per container", async () => {
    send.mockResolvedValue({ SecretString: "super-secret" });

    const first = await getSecret("app-dev-JWT_SECRET");
    const second = await getSecret("app-dev-JWT_SECRET");

    expect(first).toBe("super-secret");
    expect(second).toBe("super-secret");
    expect(send).toHaveBeenCalledTimes(1); // second call served from cache
  });

  it("fetches a different id separately", async () => {
    send.mockResolvedValue({ SecretString: "other" });
    const v = await getSecret("app-dev-OTHER");
    expect(v).toBe("other");
    expect(send).toHaveBeenCalledTimes(1);
  });
});
