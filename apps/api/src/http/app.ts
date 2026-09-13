import express, { type Express, type RequestHandler } from "express";
import type { Config } from "../infra/config.js";
import { createEldersRouter } from "../modules/elders/routes.js";
import { createEventsRouter } from "../modules/events/routes.js";
import { createFamilyRouter } from "../modules/family/routes.js";
import { createRemindersRouter } from "../modules/reminders/routes.js";
import type { Logger } from "../ports/logger.js";
import type { Services } from "../services.js";
import { cors } from "./cors.js";
import { errorHandler, notFoundHandler } from "./errors.js";
import { requireFamily } from "./require-family.js";
import { createStreamHandler } from "./sse.js";

export interface AppDeps {
  config: Config;
  log: Logger;
  services: Services;
  checkDb: () => boolean;
  whatsappWebhook: RequestHandler;
  simulate: RequestHandler;
}

export function createApp({ config, log, services, checkDb, whatsappWebhook, simulate }: AppDeps): Express {
  const app = express();
  app.disable("x-powered-by");

  app.get("/health", (_req, res) => {
    res.json({ ok: true, db: checkDb(), fallbacks: config.fallbacks });
  });

  app.post("/whatsapp", express.urlencoded({ extended: false }), whatsappWebhook);

  const api = express.Router();
  api.use(cors(config.dashboardOrigin));
  api.use(express.json({ limit: "1mb" }));
  api.use(requireFamily);
  api.use("/elders", createEldersRouter(services.elders, services.events));
  api.use("/events", createEventsRouter(services.events));
  api.use("/family", createFamilyRouter(services.family, services.elders));
  api.use("/reminders", createRemindersRouter(services.reminders));
  api.get("/stream", createStreamHandler(services.bus));
  app.use("/api", api);

  if (config.env !== "production") app.post("/dev/simulate", express.json(), simulate);

  app.use(notFoundHandler);
  app.use(errorHandler(log));
  return app;
}
