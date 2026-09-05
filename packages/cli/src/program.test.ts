import { describe, it, expect } from "vitest";
import { buildProgram } from "./program.js";

describe("buildProgram", () => {
  it("can be constructed when the bundler version define is absent", () => {
    expect(() => buildProgram()).not.toThrow();
  });
});
