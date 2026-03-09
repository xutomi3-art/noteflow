import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config) => {
    // Required for pdfjs-dist worker (webpack/production builds)
    config.resolve.alias["canvas"] = false;
    return config;
  },
  turbopack: {
    // Required for pdfjs-dist worker (Turbopack/dev mode)
    resolveAlias: {
      canvas: { browser: false },
    },
  },
};

export default nextConfig;
