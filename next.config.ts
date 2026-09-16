import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Native / node-only packages must not be bundled by Turbopack.
  serverExternalPackages: [
    "sharp",
    "playwright",
    "playwright-core",
    "postgres",
    "docx",
    "pdf-lib",
    "file-type",
  ],
  images: {
    // Media is served through our signed /api/media route; disable the optimizer for it.
    unoptimized: true,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "25mb",
    },
  },
  typedRoutes: false,
};

export default nextConfig;
