import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { env } from "@/server/env";

declare global {
  // eslint-disable-next-line no-var
  var __albertPgClient: ReturnType<typeof postgres> | undefined;
}

function createClient() {
  return postgres(env.DATABASE_URL, {
    max: env.NODE_ENV === "production" ? 20 : 10,
    idle_timeout: 30,
    connect_timeout: 10,
    prepare: false,
    onnotice: () => {},
  });
}

const client = globalThis.__albertPgClient ?? createClient();
if (env.NODE_ENV !== "production") globalThis.__albertPgClient = client;

export const db = drizzle(client, { schema });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export { schema };
