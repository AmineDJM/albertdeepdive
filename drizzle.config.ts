import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/server/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:5432/briefly",
  },
  strict: true,
  verbose: false,
});
