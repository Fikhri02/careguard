import { ListEventsQuery, type EventListResponse } from "@careguard/shared";
import { Router } from "express";
import type { EventsService } from "./service.js";

export function createEventsRouter(events: EventsService): Router {
  const router = Router();
  router.get("/", (req, res) => {
    res.json({ events: events.list(ListEventsQuery.parse(req.query)) } satisfies EventListResponse);
  });
  router.get("/:id", (req, res) => {
    res.json(events.get(req.params.id));
  });
  // `by` stays null until Auth0 identifies the family member.
  router.post("/:id/approve", async (req, res) => {
    res.json(await events.approve(req.params.id, null));
  });
  router.post("/:id/dismiss", (req, res) => {
    res.json(events.dismiss(req.params.id, null));
  });
  return router;
}
