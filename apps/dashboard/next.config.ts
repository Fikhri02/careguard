import type { NextConfig } from "next";

const config: NextConfig = {
  // @careguard/shared ships TypeScript source, not a build.
  transpilePackages: ["@careguard/shared"],
};

export default config;
