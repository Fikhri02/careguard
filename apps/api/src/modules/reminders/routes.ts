import { ListRemindersQuery, type ReminderListResponse } from "@careguard/shared";
import { Router } from "express";
import type { RemindersService } from "./service.js";

export function createRemindersRouter(reminders: RemindersService): Router {
  const router = Router();
  router.get("/", (req, res) => {
    const { elderId } = ListRemindersQuery.parse(req.query);
    res.json({ reminders: reminders.list(elderId) } satisfies ReminderListResponse);
  });
  return router;
}
