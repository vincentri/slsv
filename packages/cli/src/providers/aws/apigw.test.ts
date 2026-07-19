import { describe, it, expect } from "vitest";
import { buildCors } from "./apigw.js";
import { ConfigError } from "../../config.js";

describe("buildCors", () => {
  it("undefined → open '*'", () => {
    expect(buildCors(undefined, false)).toEqual({
      AllowOrigins: ["*"],
      AllowMethods: ["*"],
      AllowHeaders: ["*"],
    });
  });

  it("false → null (gateway CORS disabled)", () => {
    expect(buildCors(false, false)).toBeNull();
  });

  it("array → those origins, methods/headers stay '*'", () => {
    expect(buildCors(["https://a.com"], false)).toEqual({
      AllowOrigins: ["https://a.com"],
      AllowMethods: ["*"],
      AllowHeaders: ["*"],
    });
  });

  it("credentials + explicit origins → AllowCredentials, concrete defaults", () => {
    const c = buildCors({ origins: ["https://a.com"], credentials: true }, false);
    expect(c).toMatchObject({ AllowOrigins: ["https://a.com"], AllowCredentials: true });
    expect(c!.AllowMethods).not.toEqual(["*"]);
    expect(c!.AllowHeaders).not.toEqual(["*"]);
  });

  // The regression: base cors carries `credentials` but this stage never added `origins`.
  it("credentials + no origins on aws → throws (clear message)", () => {
    expect(() => buildCors({ credentials: true, methods: ["GET"] }, false)).toThrow(ConfigError);
    expect(() => buildCors({ credentials: true, methods: ["GET"] }, false)).toThrow(/explicit origins/);
  });

  it("credentials + '*' origin on aws → throws", () => {
    expect(() => buildCors({ origins: ["*"], credentials: true }, false)).toThrow(ConfigError);
  });

  it("credentials + no origins locally → permissive, no credentials (Floci owns CORS)", () => {
    const c = buildCors({ credentials: true, methods: ["GET", "POST"] }, true);
    expect(c).toEqual({ AllowOrigins: ["*"], AllowMethods: ["GET", "POST"], AllowHeaders: ["*"] });
    expect(c).not.toHaveProperty("AllowCredentials");
  });

  it("no credentials + no origins → open '*'", () => {
    expect(buildCors({ methods: ["GET"] }, false)).toMatchObject({ AllowOrigins: ["*"] });
  });
});
