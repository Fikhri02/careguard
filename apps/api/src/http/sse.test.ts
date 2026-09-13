import type { CareEvent } from "@careguard/shared";
import express from "express";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { createEventBus } from "../modules/events/bus.js";
import { createStreamHandler } from "./sse.js";

const event: CareEvent = {
  id: "evt_1",
  elderId: "eld_1",
  type: "scam_detected",
  severity: "high",
  summary: "Likely scam",
  detail: {},
  status: "new",
  createdAt: "2026-09-13T03:00:00.000Z",
  resolvedAt: null,
  resolvedBy: null,
};

describe("createStreamHandler", () => {
  it("streams bus messages as server-sent events", async () => {
    const bus = createEventBus();
    const app = express();
    app.get("/stream", createStreamHandler(bus));
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const { port } = server.address() as AddressInfo;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/stream`);
      expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();

      let text = decoder.decode((await reader.read()).value);
      expect(text).toContain(": connected");

      bus.publish({ type: "event.created", event });
      while (!text.includes("event.created")) text += decoder.decode((await reader.read()).value);
      expect(text).toContain(`data: ${JSON.stringify({ type: "event.created", event })}\n\n`);
      await reader.cancel();
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
});
