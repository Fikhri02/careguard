import type { ElderListResponse } from "@careguard/shared";
import { Router } from "express";
import type { EventsService } from "../events/service.js";
import type { EldersService } from "./service.js";

export function createEldersRouter(elders: EldersService, events: EventsService): Router {
  const router = Router();
  router.get("/", (_req, res) => {
    res.json({ elders: elders.list() } satisfies ElderListResponse);
  });
  router.get("/:id", (req, res) => {
    res.json(elders.get(req.params.id));
  });
  // The family's copilot uses this to message the elder, e.g. "tell Mak I'll call tonight".
  router.post("/:id/messages", async (req, res) => {
    const text = typeof req.body?.text === "string" ? req.body.text : "";
    res.json({ delivered: await events.messageElder(req.params.id, text) });
  });
  return router;
}
