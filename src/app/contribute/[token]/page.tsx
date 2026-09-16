import type { Metadata } from "next";
import { env } from "@/server/env";
import { resolveInvitation, toInvitationDTO } from "@/server/submissions/public";
import { ContributeForm } from "@/components/contribute/contribute-form";
import { InvalidLinkScreen } from "@/components/contribute/state-screens";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Contribute",
  description: "Tell Albert's Deep Dive what happened around you.",
  robots: { index: false, follow: false },
};

/** Public, tokenised contribution form — no account needed. */
export default async function ContributePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const resolved = await resolveInvitation(token, { markOpened: true });
  if (!resolved) return <InvalidLinkScreen />;
  const invitation = await toInvitationDTO(resolved);
  return <ContributeForm token={token} invitation={invitation} limits={{ maxFileMb: env.UPLOAD_MAX_FILE_MB, maxFiles: env.UPLOAD_MAX_FILES_PER_SUBMISSION }} />;
}
