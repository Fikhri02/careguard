import type { NextConfig } from "next";

const API_URL = process.env.API_URL ?? "http://localhost:8787";

const config: NextConfig = {
  // @careguard/shared ships TypeScript source, not a build.
  transpilePackages: ["@careguard/shared"],
  // Compression buffers streamed chunks; the live event stream must flush immediately.
  compress: false,
  async rewrites() {
    // The browser only ever talks to this origin, so there is no CORS to configure.
    // app/api/stream/route.ts is a real route and takes precedence over this rewrite.
    return [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }];
  },
};

export default config;
