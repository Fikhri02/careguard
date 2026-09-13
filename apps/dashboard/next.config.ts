import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { NextConfig } from "next";

// Keys live in the repo-root .env, shared with the API. Next.js only reads .env files in this app's folder.
const rootEnv = resolve(process.cwd(), "../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
process.env.COPILOTKIT_TELEMETRY_DISABLED ??= "true";

const API_URL = process.env.API_URL ?? "http://localhost:8787";

const config: NextConfig = {
  // @careguard/shared ships TypeScript source, not a build.
  transpilePackages: ["@careguard/shared"],
  // Compression buffers streamed chunks; the live event stream must flush immediately.
  compress: false,
  async rewrites() {
    // The browser only ever talks to this origin, so there is no CORS to configure.
    // app/api/stream and app/api/copilotkit are real routes and take precedence over this rewrite.
    return [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }];
  },
};

export default config;
