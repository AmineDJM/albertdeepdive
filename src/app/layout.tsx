import type { Metadata } from "next";
import "./globals.css";
import { fontVariables } from "@/lib/fonts";
import { AppProviders } from "@/components/providers";
import { BRAND } from "@/lib/brand";
import { currentLocale, getUi } from "@/server/i18n/locale";

export const metadata: Metadata = {
  title: {
    default: `${BRAND.name} — ${BRAND.tagline}`,
    template: `%s · ${BRAND.name}`,
  },
  description: BRAND.description,
  applicationName: BRAND.name,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await currentLocale();
  // Pins the request's interface language before anything beneath renders; see `ui()`.
  await getUi();
  return (
    <html lang={locale} className={`${fontVariables} h-full antialiased`} suppressHydrationWarning>
      <body className="flex min-h-full flex-col">
        <AppProviders locale={locale}>{children}</AppProviders>
      </body>
    </html>
  );
}
