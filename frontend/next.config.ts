import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // Stub out the canvas native module (not available in browser / Node builds)
    resolveAlias: {
      canvas: "./empty-module.ts",
    },
  },
  webpack: (config) => {
    // Fallback alias for non-Turbopack builds
    config.resolve.alias["canvas"] = false;
    return config;
  },
};

export default nextConfig;
