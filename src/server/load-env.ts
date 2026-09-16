/* Loads .env for CLI scripts without overriding variables already present in the environment. */
import { readFileSync } from "node:fs";
import path from "node:path";

for (const file of [".env", ".env.local"]) {
  try {
    const content = readFileSync(path.join(process.cwd(), file), "utf8");
    for (const rawLine of content.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    /* file absent */
  }
}
