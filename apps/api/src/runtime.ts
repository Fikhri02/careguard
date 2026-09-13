import type { Express } from "express";
import { createConsoleMessenger } from "./adapters/console-messenger.js";
import { createExaSearch } from "./adapters/exa-search.js";
import { createInProcessScheduler } from "./adapters/in-process-scheduler.js";
import { nullSearch } from "./adapters/null-search.js";
import { offlineUrlReputation } from "./adapters/offline-url-reputation.js";
import { createOpenAiLlm, disabledLlm } from "./adapters/openai-llm.js";
import { createRoutingMessenger } from "./adapters/routing-messenger.js";
import { createTelegramMessenger } from "./adapters/telegram-messenger.js";
import { createTelegramClient } from "./channels/telegram/client.js";
import { createTelegramPoller, type TelegramPoller } from "./channels/telegram/poller.js";
import { createSafeBrowsing } from "./adapters/safe-browsing.js";
import { systemClock } from "./adapters/system-clock.js";
import { createTwilioMediaFetcher, noMedia } from "./adapters/twilio-media.js";
import { createTwilioMessenger } from "./adapters/twilio-messenger.js";
import { createInboundPipeline, type InboundPipeline } from "./agent/pipeline.js";
import { buildTools } from "./agent/registry.js";
import { createTurnQueue } from "./agent/turn-queue.js";
import { createSimulateHandler } from "./channels/simulate.js";
import { createWhatsAppWebhook } from "./channels/whatsapp/webhook.js";
import { createApp } from "./http/app.js";
import type { Config } from "./infra/config.js";
import { openDb, type Db } from "./infra/db.js";
import type { Logger } from "./ports/logger.js";
import { createServices, type Services } from "./services.js";

export interface Runtime {
  config: Config;
  log: Logger;
  db: Db;
  services: Services;
  pipeline: InboundPipeline;
  app: Express;
  /** Present when TELEGRAM_BOT_TOKEN is set; main.ts starts it. */
  telegram?: TelegramPoller;
  close(): void;
}

/** The composition root: picks a real adapter or its fallback for every port, based on config. */
export function createRuntime(config: Config, log: Logger): Runtime {
  const db = openDb(config.databasePath);
  const clock = systemClock;
  const whatsappMessenger = config.twilio ? createTwilioMessenger(config.twilio, log) : createConsoleMessenger(log);
  const telegramClient = config.telegramBotToken ? createTelegramClient({ token: config.telegramBotToken }, log) : undefined;
  // One messenger for every sender: `telegram:` addresses go to Telegram, the rest to WhatsApp (or the console).
  const messenger = createRoutingMessenger({
    telegram: telegramClient ? createTelegramMessenger(telegramClient) : undefined,
    fallback: whatsappMessenger,
  });
  const search = config.exaApiKey ? createExaSearch({ apiKey: config.exaApiKey }, log) : nullSearch;
  const urlReputation = config.safeBrowsingKey ? createSafeBrowsing({ apiKey: config.safeBrowsingKey }, log) : offlineUrlReputation;
  const llm = config.openai ? createOpenAiLlm({ ...config.openai, model: config.model }) : disabledLlm;

  const services = createServices({
    db,
    clock,
    log,
    messenger,
    scheduler: createInProcessScheduler(clock, log),
    search,
    urlReputation,
  });
  const pipeline = createInboundPipeline({
    services,
    tools: buildTools({ ...services, search }),
    llm,
    queue: createTurnQueue(),
    clock,
    log,
  });

  const app = createApp({
    config,
    log,
    services,
    checkDb: () => {
      try {
        db.prepare("SELECT 1").get();
        return true;
      } catch {
        return false;
      }
    },
    whatsappWebhook: createWhatsAppWebhook({
      pipeline,
      messenger,
      fetchMedia: config.twilio ? createTwilioMediaFetcher(config.twilio, log) : noMedia,
      log,
      signature:
        config.twilio && config.publicUrl ? { authToken: config.twilio.authToken, publicUrl: config.publicUrl } : undefined,
    }),
    simulate: createSimulateHandler(pipeline),
  });

  const telegram = telegramClient
    ? createTelegramPoller({ client: telegramClient, pipeline, family: services.family, elders: services.elders, messenger, log })
    : undefined;

  return { config, log, db, services, pipeline, app, telegram, close: () => db.close() };
}
