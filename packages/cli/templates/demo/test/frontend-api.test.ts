import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Example: unit-test the frontend API helper. frontend/src/api.ts resolves its base URL at
// module load — VITE_API_URL || VITE_SLSV_API_URL || "" — then api(path) = fetch(base + path).
// Stub import.meta.env (via vi.stubEnv) + global fetch, and re-import the module per case.

const fetchMock = vi.fn(() => Promise.resolve({ ok: true } as Response));

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const load = () => import("../frontend/src/api.js") as Promise<{ api: typeof fetch }>;

describe("demo frontend api base", () => {
  it("prefers VITE_API_URL when set", async () => {
    vi.stubEnv("VITE_API_URL", "https://custom.example");
    vi.stubEnv("VITE_SLSV_API_URL", "https://slsv.example");
    (await load()).api("/api/links");
    expect(fetchMock).toHaveBeenCalledWith("https://custom.example/api/links", undefined);
  });

  it("falls back to VITE_SLSV_API_URL", async () => {
    vi.stubEnv("VITE_SLSV_API_URL", "https://slsv.example");
    (await load()).api("/api/links");
    expect(fetchMock).toHaveBeenCalledWith("https://slsv.example/api/links", undefined);
  });

  it("uses a relative base when neither is set", async () => {
    (await load()).api("/api/links");
    expect(fetchMock).toHaveBeenCalledWith("/api/links", undefined);
  });
});
