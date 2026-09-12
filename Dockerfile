# Deploy the HTTP surface to Google Cloud Run (sponsor):
#   gcloud run deploy agent --source . --allow-unauthenticated \
#     --set-env-vars OPENAI_API_KEY=...,EXA_API_KEY=...,MODEL=gpt-4o-mini
FROM node:22-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev && npm install tsx
COPY . .
ENV PORT=8080
EXPOSE 8080
CMD ["npx", "tsx", "src/surfaces/server.ts"]
