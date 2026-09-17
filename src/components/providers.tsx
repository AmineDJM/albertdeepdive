"use client";

import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LocaleProvider } from "@/components/i18n/provider";
import type { Locale } from "@/lib/i18n";

export function AppProviders({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
      <LocaleProvider locale={locale}>
        <TooltipProvider delayDuration={200}>
        {children}
        <Toaster
          position="bottom-right"
          closeButton
          toastOptions={{
            classNames: {
              toast: "!rounded-md !border-border !bg-card !text-card-foreground !shadow-lg !text-[13px]",
              description: "!text-muted-foreground",
            },
          }}
        />
        </TooltipProvider>
      </LocaleProvider>
    </ThemeProvider>
  );
}
