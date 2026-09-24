import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/session";
import { homeFor } from "@/server/tenancy/context";
import { SignupForm } from "./signup-form";
import { BrieflyLogo, BrieflyMark } from "@/components/brand/briefly-mark";
import { BRAND } from "@/lib/brand";
import { getUi } from "@/server/i18n/locale";

export const metadata: Metadata = { title: "Create your account" };
export const dynamic = "force-dynamic";

/** The other half of the door. Same room as sign-in, so the two pages read as one place. */
export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string; plan?: string; website?: string }> }) {
  const tr = await getUi();
  const user = await getCurrentUser();
  if (user) redirect(await homeFor(user));
  const { next, plan, website } = await searchParams;
  // The address typed on the landing page travels with the person and waits in onboarding's field.
  const query = new URLSearchParams(Object.entries({ plan, website: website?.trim().slice(0, 200) }).filter((entry): entry is [string, string] => Boolean(entry[1])));
  const target = next ?? (query.size ? `/onboarding?${query}` : "/onboarding");
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-[#F5F5F7] p-12 text-foreground lg:flex dark:bg-card">
        <div className="flex items-center gap-3">
          <BrieflyMark className="size-8" />
          <span className="text-[17px] font-semibold tracking-[-0.03em]">{BRAND.name}</span>
        </div>
        <div className="relative z-10 max-w-lg">
          <h1 className="masthead text-[64px] leading-[0.95] font-semibold text-foreground">
            {tr("Give Briefly")}{" "}<br />
            {tr("what happened.")}</h1>
          <p className="mt-6 max-w-md text-[15px] leading-6 text-muted-foreground">{tr("Briefly collects what your organization has to say, turns it into an edition, and sends it. You approve.")}</p>
          <ul className="mt-10 space-y-2 text-sm text-foreground/85">
            <li>{tr("Your first edition in one click.")}</li>
            <li>{tr("Email, web, PDF and print from the same work.")}</li>
            <li>{tr("Your brand, read off your own website.")}</li>
          </ul>
        </div>
        <p className="text-xs text-muted-foreground">{tr("No card to start.")}</p>
        <div aria-hidden className="pointer-events-none absolute -right-40 -bottom-40 size-[560px] rounded-full bg-[conic-gradient(from_200deg,#4285F4,#EA4335,#FBBC04,#34A853,#4285F4)] opacity-30 blur-3xl" />
      </aside>
      <main className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <BrieflyLogo height={26} />
          </div>
          <h2 className="text-lg font-semibold tracking-tight">{tr("Start for free")}</h2>
          <p className="mt-1 mb-6 text-[13px] text-muted-foreground">{tr("Make an account, then tell Briefly about your organization.")}</p>
          <SignupForm next={target} />
          <p className="mt-6 text-center text-[13px] text-muted-foreground">
            {tr("Already have an account?")}{" "}
            <Link href="/login" className="font-medium text-brand hover:underline">{tr("Sign in")}</Link>
          </p>
        </div>
      </main>
    </div>
  );
}
