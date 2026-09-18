import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/session";
import { NEWSROOM_ROLES } from "@/lib/auth/permissions";
import { NewsroomFrame } from "@/components/newsroom/frame";
import { getTenant, homeWithoutWorkspace } from "@/server/tenancy/context";

/**
 * The newsroom: every screen here is about one workspace, so there has to be one.
 *
 * Someone with none has nothing to look at — every screen would be empty — and is sent where they
 * belong: platform staff to the console, anyone else to create a workspace. The console and the
 * pages about the person rather than a workspace live in the `(platform)` group, which has no
 * such requirement.
 */
export default async function NewsroomLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!NEWSROOM_ROLES.includes(user.role)) redirect("/login?reason=contributor");
  const tenant = await getTenant();
  if (!tenant) redirect(homeWithoutWorkspace(user));
  return (
    <NewsroomFrame user={user} tenant={tenant}>
      {children}
    </NewsroomFrame>
  );
}
