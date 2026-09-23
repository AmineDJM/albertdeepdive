import Link from "next/link";
import { redirect } from "next/navigation";
import { count, eq } from "drizzle-orm";
import { Check } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { requireTenant } from "@/server/tenancy/context";
import { activeBrand } from "@/server/brand/service";
import { envelopeFor } from "@/server/email/sender";
import { getSendingDomain } from "@/server/email/domains";
import { usageReport } from "@/server/billing/entitlements";
import { listMembers } from "@/server/tenancy/service";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { PageBody, PageHeader } from "@/components/newsroom/page-header";
import { experienceOf } from "@/lib/experience";
import { cn } from "@/lib/utils";
import { listMyOrganizationsDetailed } from "@/server/tenancy/service";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

/**
 * Settings, in Standard: one line per thing, with where it stands.
 *
 * "Brand — Ready ✓", "Email sending — Your name, Briefly's address", "Audience — 412 readers". A person sees at a
 * glance what is set up and what is not, and opens only the line that needs them. The pages
 * behind each line are the same pages Advanced lists in full; this is the shorter way in.
 * Advanced goes straight to the profile, as it always did.
 */
export default async function SettingsIndex() {
  const tr = await getUi();
  const [user, tenant] = await Promise.all([getCurrentUser(), requireTenant()]);
  if (!user) redirect("/login");
  if (experienceOf(user.preferences) === "advanced") redirect("/settings/profile");
  const canSetUp = hasPermission(user, "settings:manage") || tenant.role === "OWNER" || tenant.role === "ADMIN";
  const [brand, sender, domain, report, members, mine, [subs]] = await Promise.all([
    activeBrand(tenant.organizationId),
    envelopeFor(tenant.organizationId).catch(() => null),
    getSendingDomain(tenant.organizationId),
    usageReport(tenant.organizationId).catch(() => null),
    listMembers(tenant.organizationId).catch(() => []),
    listMyOrganizationsDetailed(user.id).catch(() => []),
    db.select({ n: count() }).from(s.subscribers).where(eq(s.subscribers.organizationId, tenant.organizationId)),
  ]);
  const subscribers = Number(subs?.n ?? 0);
  const languageNames: Record<string, string> = { en: tr("English"), fr: tr("French") };
  const emailValue = domain?.status === "READY" ? tr("Ready") : domain?.status === "NEEDS_ATTENTION" ? tr("Needs attention") : domain ? tr("Setting up") : sender && sender.transport !== "log" ? tr("Your name, Briefly's address") : tr("Not set up");
  type Row = { href: string; label: string; value: string; hint?: string | null; state: "ready" | "attention" | "plain"; action: string; show: boolean };
  const rows: Row[] = [
    { href: "/settings/profile", label: tr("Experience"), value: tr("Standard"), hint: tr("Advanced opens every door"), state: "plain", action: tr("Change"), show: true },
    { href: "/settings/organizations", label: tr("Your organisations"), value: mine.length === 1 ? tr("1 organisation") : tr("{count} organisations", { count: mine.length }), hint: tr("where you belong, and your role"), state: "plain", action: tr("See"), show: true },
    { href: "/settings/workspace", label: tr("Workspace"), value: tenant.name, hint: languageNames[tenant.locale] ?? tenant.locale, state: "plain", action: tr("Change"), show: canSetUp },
    { href: "/settings/brand", label: tr("Brand"), value: brand ? tr("Ready") : tr("Not set up"), hint: brand ? tr("colours, type and voice, from your site") : tr("Briefly reads it from your website"), state: brand ? "ready" : "attention", action: brand ? tr("Change") : tr("Set up"), show: canSetUp },
    { href: "/settings/email", label: tr("Email sending"), value: emailValue, hint: sender?.from ?? null, state: domain?.status === "READY" ? "ready" : domain?.status === "NEEDS_ATTENTION" || !sender ? "attention" : "plain", action: domain?.status === "READY" ? tr("Change") : tr("Set up"), show: canSetUp },
    { href: "/subscribers", label: tr("Audience"), value: subscribers === 1 ? tr("1 subscriber") : tr("{count} subscribers", { count: subscribers }), hint: subscribers ? null : tr("add readers or share your subscribe page"), state: subscribers ? "plain" : "attention", action: tr("Manage"), show: hasPermission(user, "contributor:manage") },
    { href: "/settings/users", label: tr("People"), value: members.length === 1 ? tr("1 member") : tr("{count} members", { count: members.length }), state: "plain", action: tr("Manage"), show: hasPermission(user, "user:manage") },
    { href: "/settings/billing", label: tr("Plan"), value: report?.plan.planName ?? tr("Free"), hint: report ? tr("what you get and what you use") : null, state: "plain", action: tr("See"), show: canSetUp },
    { href: "/settings/help", label: tr("Help"), value: tr("How Briefly works"), state: "plain", action: tr("Read"), show: true },
  ];
  return (
    <>
      <PageHeader title={tr("Settings")} description={tr("Everything Briefly set up for you, and where to change it.")} />
      <PageBody className="max-w-3xl">
        <ul className="divide-y divide-border/70 rounded-xl border border-border bg-card shadow-xs" data-testid="settings-overview">
          {rows
            .filter((row) => row.show)
            .map((row) => (
              <li key={row.href}>
                <Link href={row.href} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors duration-150 hover:bg-muted/40">
                  <span className="w-[120px] shrink-0 text-xs font-medium text-muted-foreground">{row.label}</span>
                  <span className={cn("flex min-w-0 flex-1 items-center gap-2 text-[13px]", row.state === "attention" && "text-warning")}>
                    {row.state === "ready" ? <Check className="size-3.5 text-success" aria-hidden="true" /> : null}
                    <span className="truncate font-medium">{row.value}</span>
                    {row.hint ? <span className="truncate text-xs text-muted-foreground">{row.hint}</span> : null}
                  </span>
                  <span className="shrink-0 text-xs font-medium text-brand">{row.action}</span>
                </Link>
              </li>
            ))}
        </ul>
      </PageBody>
    </>
  );
}
