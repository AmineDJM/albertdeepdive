import type { Viewport } from "next";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#2BAFE0",
};

/** Public contribution pages: no newsroom chrome, paper background, full height. */
export default function ContributeLayout({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-full flex-1 flex-col">{children}</main>;
}
