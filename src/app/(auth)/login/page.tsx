import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/session";
import { env } from "@/server/env";
import { LoginForm } from "./login-form";
import { AlbertMark } from "@/components/newsroom/albert-mark";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const user = await getCurrentUser();
  if (user) redirect("/overview");
  const { next } = await searchParams;
  const demo = env.NODE_ENV !== "production" ? { email: env.SEED_ADMIN_EMAIL, password: env.SEED_ADMIN_PASSWORD } : null;
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-[oklch(0.22_0.05_262)] p-12 text-white lg:flex">
        <div className="flex items-center gap-3">
          <AlbertMark className="size-8" />
          <span className="text-sm font-medium tracking-wide text-white/80">Albert School · Newsroom</span>
        </div>
        <div className="relative z-10 max-w-lg">
          <h1 className="masthead text-[64px] leading-[0.95] font-semibold text-white">
            Albert&rsquo;s
            <br />
            Deep Dive
          </h1>
          <p className="mt-6 max-w-md text-[15px] leading-6 text-white/70">
            The operating system of the monthly newspaper: collect what happened on every campus, turn it into verified stories, write with AI assistance, lay out the issue and publish — with a human decision at every step.
          </p>
          <dl className="mt-10 grid grid-cols-3 gap-6 text-sm">
            <div>
              <dt className="text-2xs uppercase tracking-[0.12em] text-white/50">Collect</dt>
              <dd className="mt-1 text-white/85">Tokenised contribution links, reminders, photos</dd>
            </div>
            <div>
              <dt className="text-2xs uppercase tracking-[0.12em] text-white/50">Verify</dt>
              <dd className="mt-1 text-white/85">Story clusters, fact sheets, provenance</dd>
            </div>
            <div>
              <dt className="text-2xs uppercase tracking-[0.12em] text-white/50">Publish</dt>
              <dd className="mt-1 text-white/85">Deterministic layout, PDF and DOCX</dd>
            </div>
          </dl>
        </div>
        <p className="text-xs text-white/40">Albert Deep Dive · Special issue N°1 was produced in May 2025 by the student editorial team.</p>
        <div className="pointer-events-none absolute -right-40 -bottom-40 size-[520px] rounded-full bg-brand/30 blur-3xl" />
        <div className="pointer-events-none absolute -right-10 top-1/3 size-56 rounded-full bg-brand/60" />
        <div className="pointer-events-none absolute right-40 top-[calc(33%+80px)] size-10 rounded-full bg-[oklch(0.2_0.04_262)]" />
      </aside>
      <main className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <AlbertMark className="size-7" />
            <span className="masthead text-xl font-semibold">Albert&rsquo;s Deep Dive</span>
          </div>
          <h2 className="text-lg font-semibold tracking-tight">Sign in</h2>
          <p className="mt-1 mb-6 text-[13px] text-muted-foreground">Editors, campus editors and the editor in chief sign in here. Contributors use their personal link.</p>
          <LoginForm next={next} demo={demo} />
          {demo ? (
            <div className="mt-6 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Demo accounts (development)</p>
              <p className="mt-1">
                {demo.email} (super admin), eic@albertschool.com, editor@albertschool.com, lyon@albertschool.com, viewer@albertschool.com — password <span className="font-mono">{demo.password}</span>
              </p>
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
