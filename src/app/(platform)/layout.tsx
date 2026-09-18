import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/session";
import { NEWSROOM_ROLES } from "@/lib/auth/permissions";
import { NewsroomFrame } from "@/components/newsroom/frame";
import { getTenant } from "@/server/tenancy/context";

/**
 * The screens that need a person but not a workspace: the platform console, and the pages about
 * the person themselves. Platform staff belong to no customer, so nothing here assumes a tenant —
 * when one is open, the shell shows it; when none is, the shell shows the console alone.
 */
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!NEWSROOM_ROLES.includes(user.role)) redirect("/login?reason=contributor");
  const tenant = await getTenant();
  return (
    <NewsroomFrame user={user} tenant={tenant}>
      {children}
    </NewsroomFrame>
  );
}
