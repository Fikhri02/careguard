import type { ElderListResponse } from "@careguard/shared";
import { Router } from "express";
import type { EldersService } from "./service.js";

export function createEldersRouter(elders: EldersService): Router {
  const router = Router();
  router.get("/", (_req, res) => {
    res.json({ elders: elders.list() } satisfies ElderListResponse);
  });
  router.get("/:id", (req, res) => {
    res.json(elders.get(req.params.id));
  });
  return router;
}
