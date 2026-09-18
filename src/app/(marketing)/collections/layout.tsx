import Link from "next/link";
import { getCurrentUser } from "@/server/auth/session";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { BrieflyLogo } from "@/components/brand/briefly-mark";
import { getUi } from "@/server/i18n/locale";
import { BRAND } from "@/lib/brand";

/** The gallery wears the marketing site's chrome: it is the same shop window, one aisle further in. */
export default async function CollectionsLayout({ children }: { children: React.ReactNode }) {
  const [user, tr] = await Promise.all([getCurrentUser().catch(() => null), getUi()]);
  return (
    <div className="min-h-screen bg-background">
      <MarketingHeader signedIn={Boolean(user)} />
      <main>{children}</main>
      <footer className="border-t border-border px-5 py-10 sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <Link href="/" className="flex items-center gap-2" aria-label={BRAND.name}>
            <BrieflyLogo height={20} />
          </Link>
          <nav className="flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-muted-foreground" aria-label={BRAND.name}>
            <Link href="/collections" className="hover:text-foreground">{tr("The gallery")}</Link>
            <Link href="/#pricing" className="hover:text-foreground">{tr("Pricing")}</Link>
            <Link href="/login" className="hover:text-foreground">{tr("Log in")}</Link>
          </nav>
          <p className="text-2xs text-muted-foreground">
            © {new Date().getFullYear()} {BRAND.name}. {tr("Every publication shown with its owner’s permission.")}
          </p>
        </div>
      </footer>
    </div>
  );
}
