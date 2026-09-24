import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  /*
   * The loopback address is the same machine, whatever the dev server thinks.
   *
   * `next dev` only trusts `localhost` by default and blocks its own dev resources for any other
   * host — so the end-to-end suite, which drives `http://127.0.0.1`, served pages whose client
   * bundle never connected and therefore never hydrated: every button on every screen was inert,
   * and every spec that clicked one failed for a reason no screenshot could show. Development only.
   */
  allowedDevOrigins: ["127.0.0.1", "localhost", "0.0.0.0"],
  // Native / node-only packages must not be bundled by Turbopack.
  serverExternalPackages: [
    "sharp",
    "playwright",
    "playwright-core",
    "postgres",
    "docx",
    "pdf-lib",
    // pdf.js, for reading the text of a PDF dropped on the Topics screen.
    "unpdf",
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
