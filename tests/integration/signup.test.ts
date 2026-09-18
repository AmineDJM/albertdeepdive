import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { signUpAction } from "@/app/(auth)/signup/actions";

// A server action reads the request through `next/headers`, which only exists while a request is
// being served. The test supplies the two things this action asks for: who is calling, and
// somewhere to put the session cookie.
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "user-agent": "vitest", "x-forwarded-for": "127.0.0.1" }),
  cookies: async () => ({
    set: (name: string, value: string) => jar.set(name, value),
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    delete: (name: string) => jar.delete(name),
  }),
}));

/**
 * The door that was not there.
 *
 * Every "Start for free" on the marketing site went to the sign-in page, which only lets in people
 * who already have an account, so a visitor could read the whole site and never become a customer.
 * These pin the new path: a real account, signed in, handed to onboarding.
 */
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.append(k, v);
  return data;
};

// `redirect()` throws a Next control-flow error; catching it is how a test reads the destination.
async function run(fields: Record<string, string>) {
  try {
    const result = await signUpAction(null, form(fields));
    return { result, redirectedTo: null as string | null };
  } catch (err) {
    const digest = (err as { digest?: string }).digest ?? "";
    if (!digest.startsWith("NEXT_REDIRECT")) throw err;
    return { result: null, redirectedTo: digest.split(";")[2] ?? digest };
  }
}

describe("creating an account", () => {
  const email = `new-${Date.now()}@example.com`;

  beforeAll(async () => {
    await ensureSeeded();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("makes the person, signs them in and sends them to onboarding", async () => {
    const { redirectedTo } = await run({ name: "Alex Martin", email, password: "a-long-enough-password", confirm: "a-long-enough-password" });
    expect(redirectedTo).toContain("/onboarding");
    const user = await db.query.users.findFirst({ where: eq(s.users.email, email) });
    expect(user).toBeTruthy();
    expect(user!.name).toBe("Alex Martin");
    // An editor in chief of nothing yet: onboarding makes them the owner of their workspace.
    expect(user!.role).toBe("EDITOR_IN_CHIEF");
    expect(user!.isActive).toBe(true);
    // The password is hashed, never stored as typed.
    expect(user!.passwordHash).not.toContain("a-long-enough-password");
    const session = await db.query.sessions.findFirst({ where: eq(s.sessions.userId, user!.id) });
    expect(session).toBeTruthy();
  });

  it("keeps a plan choice through the signup", async () => {
    const { redirectedTo } = await run({ name: "Sam Dubois", email: `plan-${Date.now()}@example.com`, password: "another-long-password", confirm: "another-long-password", next: "/onboarding?plan=pro" });
    expect(redirectedTo).toContain("plan=pro");
  });

  it("refuses an address that already has an account, and says where to go", async () => {
    const { result } = await run({ name: "Someone Else", email, password: "yet-another-password", confirm: "yet-another-password" });
    expect(result?.ok).toBe(false);
    expect(result && !result.ok ? result.fieldErrors?.email?.[0] : "").toMatch(/sign in/i);
  });

  it("refuses a short password and a mismatch", async () => {
    const short = await run({ name: "Too Short", email: `short-${Date.now()}@example.com`, password: "abc", confirm: "abc" });
    expect(short.result?.ok).toBe(false);
    expect(short.result && !short.result.ok ? short.result.fieldErrors?.password : undefined).toBeTruthy();
    const mismatch = await run({ name: "Mismatch", email: `mismatch-${Date.now()}@example.com`, password: "a-long-enough-password", confirm: "a-different-password" });
    expect(mismatch.result?.ok).toBe(false);
    expect(mismatch.result && !mismatch.result.ok ? mismatch.result.fieldErrors?.confirm : undefined).toBeTruthy();
  });

  it("will not take an address that is not one", async () => {
    const { result } = await run({ name: "Bad Email", email: "not-an-email", password: "a-long-enough-password", confirm: "a-long-enough-password" });
    expect(result?.ok).toBe(false);
  });
});
