import type { RequestHandler } from "express";
import type { EventBus } from "../modules/events/bus.js";

export function createStreamHandler(bus: EventBus, { heartbeatMs = 25_000 }: { heartbeatMs?: number } = {}): RequestHandler {
  return (req, res) => {
    res.status(200).set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    res.write(": connected\n\n");

    const unsubscribe = bus.subscribe((message) => {
      res.write(`data: ${JSON.stringify(message)}\n\n`);
    });
    const heartbeat = setInterval(() => res.write(": ping\n\n"), heartbeatMs);

    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  };
}
