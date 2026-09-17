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
    // SheetJS reads the uploaded spreadsheet on the server (contributor import); keep it out of the bundle.
    "xlsx",
    // The mail stack resolves encodings and MIME handlers at runtime; bundling it makes Turbopack
    // trace the whole project.
    "nodemailer",
    "imapflow",
    "mailparser",
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
