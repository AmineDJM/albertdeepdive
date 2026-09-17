import "@/server/load-env";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { hashPassword } from "@/server/auth/password";
import { env } from "@/server/env";

/**
 * Sets (or creates) the administrator's password.
 *
 * Run it in the service's shell when you cannot get in — for example after a first deploy where
 * the password was generated rather than chosen:
 *
 *   pnpm reset-admin                       # uses SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD
 *   pnpm reset-admin admin@school.com hunter2   # sets an address and password you choose
 *
 * It never touches anything but that one account, so a live newsroom's data is safe.
 */
async function main() {
  const email = (process.argv[2] || env.SEED_ADMIN_EMAIL).trim().toLowerCase();
  const password = process.argv[3] || env.SEED_ADMIN_PASSWORD;
  if (!password) throw new Error("Give a password as the second argument, or set SEED_ADMIN_PASSWORD.");

  const passwordHash = await hashPassword(password);
  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });

  if (existing) {
    await db.update(users).set({ passwordHash, isActive: true }).where(eq(users.id, existing.id));
    console.log(`[reset-admin] password updated for ${email} (${existing.role}).`);
  } else {
    await db.insert(users).values({ email, name: "Newsroom Admin", role: "SUPER_ADMIN", passwordHash, isActive: true });
    console.log(`[reset-admin] created ${email} as SUPER_ADMIN.`);
  }
  console.log("[reset-admin] you can sign in now. Change the password in Settings → Profile.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[reset-admin] failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
