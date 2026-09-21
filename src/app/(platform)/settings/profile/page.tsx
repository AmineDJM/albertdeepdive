import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser, SESSION_COOKIE } from "@/server/auth/session";
import { getOwnProfile } from "@/server/settings/users";
import { PageBody, PageHeader } from "@/components/newsroom/page-header";
import { Badge } from "@/components/ui/badge";
import { CampusChip } from "@/components/newsroom/campus-chip";
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/lib/auth/permissions";
import { formatDate } from "@/lib/utils";
import { ExperienceForm, IdentityForm, PasswordForm, SessionsCard, ThemeForm } from "./profile-forms";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const tr = await getUi();
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const store = await cookies();
  const profile = await getOwnProfile(user.id, store.get(SESSION_COOKIE)?.value ?? null);
  return (
    <>
      <PageHeader
        title={tr("Profile")}
        description={`${ROLE_LABELS[profile.role]} — ${ROLE_DESCRIPTIONS[profile.role]}`}
        meta={
          <>
            <Badge variant="outline">{ROLE_LABELS[profile.role]}</Badge>
            {profile.campus ? <CampusChip name={profile.campus.name} colour={profile.campus.colour} /> : null}
          </>
        }
      />
      <PageBody className="max-w-3xl space-y-4">
        <ExperienceForm saved={profile.experience} />
        <IdentityForm name={profile.name} email={profile.email} username={profile.username} suggestedUsername={profile.suggestedUsername} />
        <PasswordForm />
        <ThemeForm saved={profile.theme} />
        <SessionsCard sessions={profile.sessions} />
        <p className="text-2xs text-muted-foreground">
          {tr("Member since")}{" "}{formatDate(profile.createdAt)}
          {profile.lastLoginAt ? ` · last sign-in ${formatDate(profile.lastLoginAt)}` : ""}.
        </p>
      </PageBody>
    </>
  );
}
