import Link from "next/link";
import { notFound } from "next/navigation";
import { Activity, ArrowLeft, Building2, Cpu, KeyRound, LogIn, UserRound } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { userSheet } from "@/server/platform/insights";
import { PageBody, PageHeader, SectionTitle } from "@/components/newsroom/page-header";
import { DataTable } from "@/components/newsroom/data-table";
import { Stat, StatGrid } from "@/components/newsroom/stat";
import { Bars } from "@/components/newsroom/bars";
import { Badge } from "@/components/ui/badge";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { formatSpend } from "@/lib/format";
import { formatDate, formatDateTime, formatNumber, relativeTime } from "@/lib/utils";
import { PersonControls } from "../person-controls";
import { MemberControls } from "../../organizations/[id]/member-controls";
import { SessionControls } from "./session-controls";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

/**
 * One person, whole: who they are on the platform, where they work and as what, what they have
 * been doing and what it cost. The place a "what happened to my account" question is answered
 * from, and the place a lost laptop is dealt with.
 */
export default async function PersonSheetPage({ params }: { params: Promise<{ id: string }> }) {
  const tr = await getUi();
  const viewer = await getCurrentUser();
  if (!hasPermission(viewer, "settings:manage")) {
    return (
      <>
        <PageHeader title={tr("Person")} />
        <PageBody>
          <p className="text-[14px] text-muted-foreground">{tr("Managing accounts across every workspace is a platform job. You need to be a Briefly super admin.")}</p>
        </PageBody>
      </>
    );
  }

  const { id } = await params;
  const sheet = await userSheet(id);
  if (!sheet) notFound();
  const { user, activity, spend, sessions } = sheet;
  const currency = "EUR";
  const dayPoints = activity.byDay.map((day) => ({ label: day.day.slice(5), value: day.count, title: `${day.day}: ${day.count} ${tr("actions")}` }));

  return (
    <>
      <PageHeader
        title={user.name}
        description={`${user.email} · ${ROLE_LABELS[user.role]}${user.campus ? ` · ${user.campus}` : ""}`}
        actions={
          <>
            <SessionControls userId={user.id} active={sessions.active} />
            <PersonControls person={{ id: user.id, name: user.name, role: user.role, isActive: user.isActive, workspaces: sheet.workspaces.map((workspace) => ({ organizationId: workspace.organizationId, name: workspace.name, role: workspace.role })) }} isSelf={user.id === viewer?.id} />
          </>
        }
      >
      </PageHeader>
      <PageBody className="space-y-6">
        <Link href="/admin/users" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" />{" "}{tr("All people")}</Link>

        <StatGrid columns={5}>
          <Stat label={tr("Actions, 30 days")} value={formatNumber(activity.actions30)} hint={activity.byAction[0] ? `${tr("mostly")} ${activity.byAction[0].action}` : tr("nothing recorded")} icon={Activity} hue="cobalt" />
          <Stat label={tr("Sign-ins, 30 days")} value={formatNumber(activity.logins30)} hint={user.lastLoginAt ? `${tr("last")} ${relativeTime(user.lastLoginAt)}` : tr("never signed in")} icon={LogIn} hue="teal" />
          <Stat label={tr("Model calls, 30 days")} value={formatSpend(spend.ai30Cents, currency)} hint={`${formatNumber(spend.ai30Calls)} ${tr("calls")} · ${tr("all time")} ${formatSpend(spend.aiAllCents, currency)}`} icon={Cpu} hue="violet" />
          <Stat label={tr("Active sessions")} value={sessions.active} hint={sessions.lastSeenAt ? `${tr("last seen")} ${relativeTime(sessions.lastSeenAt)}` : tr("none")} icon={KeyRound} hue={sessions.active > 3 ? "amber" : "green"} />
          <Stat label={tr("Workspaces")} value={sheet.workspaces.length} hint={user.isActive ? tr("account active") : tr("account suspended")} icon={Building2} hue={user.isActive ? "magenta" : "coral"} />
        </StatGrid>

        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <section>
            <SectionTitle>{tr("Activity by day")}</SectionTitle>
            <div className="rounded-lg border border-border bg-card px-3 py-2">
              <Bars points={dayPoints} hue="cobalt" label={tr("Recorded actions per day over the last thirty days")} format={(value) => String(value)} />
            </div>
          </section>
          <section className="rounded-lg border border-border bg-card p-4">
            <SectionTitle>{tr("Account")}</SectionTitle>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
              <dt className="text-muted-foreground">{tr("Status")}</dt>
              <dd>{user.isActive ? <Badge variant="success">{tr("active")}</Badge> : <Badge variant="muted">{tr("suspended")}</Badge>}</dd>
              <dt className="text-muted-foreground">{tr("Created")}</dt>
              <dd>{formatDate(user.createdAt)}</dd>
              <dt className="text-muted-foreground">{tr("Last sign-in")}</dt>
              <dd>{user.lastLoginAt ? formatDateTime(user.lastLoginAt) : tr("never")}</dd>
              <dt className="text-muted-foreground">{tr("Devices")}</dt>
              <dd className="truncate">{sessions.agents.length ? sessions.agents.map((agent) => agent.split(" ")[0]).join(", ") : "—"}</dd>
              <dt className="text-muted-foreground">{tr("Studio, 30 days")}</dt>
              <dd>{formatSpend(spend.creative30Cents, currency)}</dd>
            </dl>
          </section>
        </div>

        <section>
          <SectionTitle>{tr("Workspaces")}</SectionTitle>
          <DataTable
            rows={sheet.workspaces}
            rowKey={(workspace) => workspace.organizationId}
            onRowHref={(workspace) => `/admin/organizations/${workspace.organizationId}`}
            empty={{ title: tr("No workspace"), description: user.role === "SUPER_ADMIN" ? tr("Platform staff belong to no customer.") : tr("This person has not joined a workspace yet."), icon: Building2 }}
            dense
            columns={[
              { key: "name", header: tr("Workspace"), cell: (workspace) => <span className="flex flex-col"><span className="font-medium">{workspace.name}</span><span className="font-mono text-2xs text-muted-foreground">/{workspace.slug}</span></span> },
              { key: "role", header: tr("Role"), cell: (workspace) => <span className="text-xs capitalize">{workspace.role.toLowerCase()}{workspace.isDefault ? <span className="text-muted-foreground">{" "}· {tr("default")}</span> : null}</span> },
              { key: "plan", header: tr("Plan"), cell: (workspace) => <span className="text-xs">{workspace.planName ?? "—"}</span> },
              { key: "ai", header: tr("Model calls, 30 days"), cell: (workspace) => { const line = spend.byWorkspace.find((entry) => entry.organizationId === workspace.organizationId); return <span className="tabular text-xs">{formatSpend(line?.aiCents ?? 0, currency)}<span className="text-muted-foreground">{" "}· {line?.aiCalls ?? 0}</span></span>; }, align: "right" },
              { key: "joined", header: tr("Joined"), cell: (workspace) => <span className="text-2xs text-muted-foreground">{formatDate(workspace.joinedAt)}</span>, align: "right" },
              {
                key: "manage",
                header: "",
                cell: (workspace) => (
                  <span data-no-row-link>
                    <MemberControls organizationId={workspace.organizationId} member={{ userId: user.id, name: user.name, role: workspace.role as "OWNER" | "ADMIN" | "EDITOR" | "CONTRIBUTOR" | "VIEWER", platformRole: user.role }} isSelf={user.id === viewer?.id} />
                  </span>
                ),
                align: "right",
                width: "60px",
              },
            ]}
          />
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section>
            <SectionTitle>{tr("What they do")}</SectionTitle>
            <DataTable
              rows={activity.byAction}
              rowKey={(row) => row.action}
              empty={{ title: tr("Nothing yet"), description: tr("No action recorded in the last thirty days."), icon: Activity }}
              dense
              columns={[
                { key: "action", header: tr("Action"), cell: (row) => <span className="font-mono text-xs">{row.action}</span> },
                { key: "count", header: tr("Times"), cell: (row) => <span className="tabular text-xs">{formatNumber(row.count)}</span>, align: "right" },
                { key: "last", header: tr("Last"), cell: (row) => <span className="text-2xs text-muted-foreground">{relativeTime(row.lastAt)}</span>, align: "right" },
              ]}
            />
          </section>
          <section>
            <SectionTitle>{tr("Latest actions")}</SectionTitle>
            {activity.recent.length ? (
              <ol className="divide-y divide-border rounded-lg border border-border bg-card">
                {activity.recent.map((entry) => (
                  <li key={entry.id} className="flex items-start gap-3 px-3 py-2 text-xs">
                    <span className="mt-0.5 w-20 shrink-0 text-2xs text-muted-foreground">{relativeTime(entry.at)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{entry.action}</span>
                      {entry.workspace ? <span className="text-muted-foreground">{" "}· {entry.workspace}</span> : null}
                      {entry.detail ? <span className="block truncate text-2xs text-muted-foreground">{entry.detail}</span> : null}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-xs text-muted-foreground">{tr("Nothing recorded for this account.")}</p>
            )}
          </section>
        </div>

        <p className="flex items-center gap-1.5 text-2xs text-muted-foreground">
          <UserRound className="size-3" />{" "}{tr("Account id")}{" "}<span className="font-mono">{user.id}</span>
        </p>
      </PageBody>
    </>
  );
}
