import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/session";
import { OnboardingFlow } from "./onboarding-flow";

export const metadata: Metadata = { title: "Set up your workspace" };
export const dynamic = "force-dynamic";

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ website?: string }> }) {
  const user = await getCurrentUser();
  const website = (await searchParams).website?.trim().slice(0, 200) || undefined;
  const here = website ? `/onboarding?website=${encodeURIComponent(website)}` : "/onboarding";
  if (!user) redirect(`/signup?next=${encodeURIComponent(here)}`);
  return (
    <main className="min-h-screen bg-background">
      <OnboardingFlow suggestedTimezone="Europe/Paris" website={website} />
    </main>
  );
}
