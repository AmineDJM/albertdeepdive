import type { Metadata } from "next";
import "./globals.css";
import { fontVariables } from "@/lib/fonts";
import { AppProviders } from "@/components/providers";

export const metadata: Metadata = {
  title: {
    default: "Albert Deep Dive",
    template: "%s · Albert Deep Dive",
  },
  description: "The automated monthly newsroom and publishing system of Albert School.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fontVariables} h-full antialiased`} suppressHydrationWarning>
      <body className="flex min-h-full flex-col">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
