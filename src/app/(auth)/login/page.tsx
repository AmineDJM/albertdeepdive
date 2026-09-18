import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/session";
import { homeFor } from "@/server/tenancy/context";
import { env } from "@/server/env";
import { LoginForm } from "./login-form";
import { BrieflyLogo, BrieflyMark } from "@/components/brand/briefly-mark";
import { BRAND } from "@/lib/brand";
import { getUi } from "@/server/i18n/locale";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const tr = await getUi();
  const user = await getCurrentUser();
  if (user) redirect(await homeFor(user));
  const { next } = await searchParams;
  const demo = env.NODE_ENV !== "production" ? { email: env.SEED_ADMIN_EMAIL, password: env.SEED_ADMIN_PASSWORD } : null;
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-[oklch(0.17_0.012_280)] p-12 text-white lg:flex">
        <div className="flex items-center gap-3">
          <BrieflyMark className="size-8" />
          <span className="text-sm font-medium tracking-wide text-white/80">{BRAND.name}</span>
        </div>
        <div className="relative z-10 max-w-lg">
          <h1 className="masthead text-[64px] leading-[0.95] font-semibold text-white">
            {tr("Your organization,")}{" "}<br />
            {tr("published.")}</h1>
          <p className="mt-6 max-w-md text-[15px] leading-6 text-white/70">
            {BRAND.description}
          </p>
          <dl className="mt-10 grid grid-cols-3 gap-6 text-sm">
            <div>
              <dt className="text-2xs uppercase tracking-[0.12em] text-white/50">{tr("Collect")}</dt>
              <dd className="mt-1 text-white/85">{tr("Contribution links, reminders, uploads")}</dd>
            </div>
            <div>
              <dt className="text-2xs uppercase tracking-[0.12em] text-white/50">{tr("Verify")}</dt>
              <dd className="mt-1 text-white/85">{tr("Story clusters, fact sheets, provenance")}</dd>
            </div>
            <div>
              <dt className="text-2xs uppercase tracking-[0.12em] text-white/50">{tr("Publish")}</dt>
              <dd className="mt-1 text-white/85">{tr("Email, web, magazine and print")}</dd>
            </div>
          </dl>
        </div>
        <p className="text-xs text-white/40">{tr("One edition. Every format your organization publishes in.")}</p>
        <div className="pointer-events-none absolute -right-40 -bottom-40 size-[520px] rounded-full bg-[radial-gradient(circle_at_30%_30%,#5F6AF6_0%,#6CDED1_45%,#F5A8B8_80%,transparent_100%)] opacity-40 blur-3xl" />
      </aside>
      <main className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <BrieflyLogo height={26} />
          </div>
          <h2 className="text-lg font-semibold tracking-tight">{tr("Sign in")}</h2>
          <p className="mt-1 mb-6 text-[13px] text-muted-foreground">{tr("Sign in to your workspace. Contributors use their personal link instead.")}</p>
          <LoginForm next={next} demo={demo} />
          {demo ? (
            // Development only. The sign-in page belongs to Briefly, so it names no customer: the
            // sample workspace's accounts are in the README, not here.
            <div className="mt-6 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">{tr("Development sign-in")}</p>
              <p className="mt-1">
                {tr("Platform admin")}{" "}<span className="font-mono">{demo.email}</span>{" "}{tr("— password")}{" "}<span className="font-mono">{demo.password}</span>
              </p>
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
