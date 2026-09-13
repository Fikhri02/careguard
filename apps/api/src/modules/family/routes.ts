import type { FamilyListResponse } from "@careguard/shared";
import { Router } from "express";
import type { EldersService } from "../elders/service.js";
import type { FamilyService } from "./service.js";

export function createFamilyRouter(family: FamilyService, elders: EldersService): Router {
  const router = Router();
  router.get("/", (_req, res) => {
    res.json({ family: family.listAll() } satisfies FamilyListResponse);
  });
  // The dashboard labels someone who already chats with CareGuard as an elder's family.
  router.post("/", (req, res) => {
    const personId = typeof req.body?.personId === "string" ? req.body.personId : "";
    const elderId = typeof req.body?.elderId === "string" ? req.body.elderId : "";
    const person = elders.get(personId);
    elders.get(elderId);
    res.status(201).json(family.labelAsFamily(elderId, person));
  });
  return router;
}
