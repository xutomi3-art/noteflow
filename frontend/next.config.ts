import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {},
  webpack: (config) => {
    // Required for pdfjs-dist worker
    config.resolve.alias["canvas"] = false;
    return config;
  },
};

export default nextConfig;
