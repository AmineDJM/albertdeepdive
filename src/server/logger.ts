import { env } from "@/server/env";

type Level = "debug" | "info" | "warn" | "error";
const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SECRET_KEYS = /(password|secret|token|api[_-]?key|authorization|cookie)/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[depth]";
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack?.split("\n").slice(0, 4).join(" | ") };
    if (value instanceof Date) return value.toISOString();
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.test(k) ? "[redacted]" : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

function emit(level: Level, scope: string, message: string, meta?: Record<string, unknown>) {
  if (LEVELS[level] < LEVELS[env.LOG_LEVEL]) return;
  const record = { ts: new Date().toISOString(), level, scope, message, ...(meta ? (redact(meta) as Record<string, unknown>) : {}) };
  const line = JSON.stringify(record);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function createLogger(scope: string) {
  return {
    debug: (message: string, meta?: Record<string, unknown>) => emit("debug", scope, message, meta),
    info: (message: string, meta?: Record<string, unknown>) => emit("info", scope, message, meta),
    warn: (message: string, meta?: Record<string, unknown>) => emit("warn", scope, message, meta),
    error: (message: string, meta?: Record<string, unknown>) => emit("error", scope, message, meta),
    child: (sub: string) => createLogger(`${scope}:${sub}`),
  };
}

export type Logger = ReturnType<typeof createLogger>;
export const logger = createLogger("app");
