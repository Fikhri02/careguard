import { describe, expect, it } from "vitest";
import { z } from "zod";
import { testContext } from "../test/fakes.js";
import { defineTool } from "./tool.js";

const echo = defineTool({
  name: "echo",
  description: "Echo text back.",
  input: z.object({
    text: z.string().describe("Text to echo"),
    times: z.number().optional(),
  }),
  run: async ({ text, times }, ctx) => `${ctx.elder.id}:${text.repeat(times ?? 1)}`,
});

describe("defineTool", () => {
  it("builds an OpenAI function schema from the zod input", () => {
    expect(echo.schema.type).toBe("function");
    expect(echo.schema.function.name).toBe("echo");
    expect(echo.schema.function.description).toBe("Echo text back.");
    expect(echo.schema.function.parameters).toMatchObject({
      type: "object",
      properties: { text: { type: "string", description: "Text to echo" } },
      required: ["text"],
    });
    expect(echo.schema.function.parameters).not.toHaveProperty("$schema");
  });

  it("returns a message instead of running when arguments are invalid", async () => {
    await expect(echo.run({ times: 2 }, testContext())).resolves.toMatch(/^Invalid arguments for echo/);
  });

  it("passes parsed input and context to run", async () => {
    await expect(echo.run({ text: "hi", times: 2 }, testContext())).resolves.toBe("eld_1:hihi");
  });
});
