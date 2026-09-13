# CareGuard API — Google Cloud Run
#   gcloud run deploy careguard-api --source . --no-cpu-throttling --max-instances=1 --allow-unauthenticated \
#     --set-env-vars NODE_ENV=production,PUBLIC_URL=https://<service-url>,SEED_DEMO=true,OPENAI_API_KEY=...,\
#       TWILIO_ACCOUNT_SID=...,TWILIO_AUTH_TOKEN=...,TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
# --no-cpu-throttling: turns keep running after the webhook has responded.
# --max-instances=1:   SQLite lives on this instance's (ephemeral) disk.

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/dashboard/package.json apps/dashboard/
# openai@4 pulls zod@3, which npm hoists to the root; zod@4 lands in each workspace's own node_modules.
# Create both dirs so the COPY below works even if a future lockfile hoists everything.
RUN mkdir -p apps/api/node_modules packages/shared/node_modules \
 && npm ci --omit=dev --workspace @careguard/api --workspace @careguard/shared

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080 DATABASE_PATH=/app/data/careguard.db
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
EXPOSE 8080
WORKDIR /app/apps/api
CMD ["/app/node_modules/.bin/tsx", "src/main.ts"]
