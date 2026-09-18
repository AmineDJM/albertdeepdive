import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/session";
import { OnboardingFlow } from "./onboarding-flow";

export const metadata: Metadata = { title: "Set up your workspace" };
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/signup?next=%2Fonboarding");
  return (
    <main className="min-h-screen bg-background">
      <OnboardingFlow suggestedTimezone="Europe/Paris" />
    </main>
  );
}
