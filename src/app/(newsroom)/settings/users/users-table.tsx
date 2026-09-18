"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, MoreHorizontal, Pencil, Plus, UserRoundX, UserRoundCheck } from "lucide-react";
import { toast } from "sonner";
import type { UserListRow } from "@/server/settings/users";
import { DataTable } from "@/components/newsroom/data-table";
import { CampusChip } from "@/components/newsroom/campus-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { CopyButton } from "@/components/settings/copy-button";
import { FieldError } from "@/components/settings/key-value";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, ROLES, type Role } from "@/lib/auth/permissions";
import { formatDateTime, relativeTime } from "@/lib/utils";
import { createUserAction, resetPasswordAction, updateUserAction } from "./actions";
import { useUi } from "@/components/i18n/provider";

type Campus = { id: string; name: string };
type Form = { name: string; email: string; role: Role; campusId: string | null; isActive: boolean };

const EMPTY: Form = { name: "", email: "", role: "EDITOR", campusId: null, isActive: true };

export function UsersTable({ users, campuses, currentUserId }: { users: UserListRow[]; campuses: Campus[]; currentUserId: string }) {
  const tr = useUi();
  const router = useRouter();
  const [editing, setEditing] = useState<{ mode: "create" } | { mode: "edit"; user: UserListRow } | null>(null);
  const [secret, setSecret] = useState<{ title: string; email: string; password: string } | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "reset" | "deactivate"; user: UserListRow } | null>(null);
  const [pending, start] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        toast.error(res.error ?? "Something went wrong");
        return;
      }
      if (res.message) toast.success(res.message);
      router.refresh();
    });
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {users.filter((u) => u.isActive).length}{" "}{tr("active ·")}{" "}{users.filter((u) => !u.isActive).length}{" "}{tr("deactivated")}</p>
        <Button size="sm" onClick={() => setEditing({ mode: "create" })}>
          <Plus />{" "}{tr("Invite user")}</Button>
      </div>
      <DataTable
        rows={users}
        rowKey={(u) => u.id}
        dense
        empty={{ title: tr("No users yet"), description: tr("Invite the first editor.") }}
        columns={[
          {
            key: "name",
            header: tr("User"),
            cell: (u) => (
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{u.name}</span>
                  {u.id === currentUserId ? <Badge variant="brand">{tr("You")}</Badge> : null}
                  {!u.isActive ? <Badge variant="muted">{tr("Deactivated")}</Badge> : null}
                </div>
                <div className="truncate text-2xs text-muted-foreground">{u.email}</div>
              </div>
            ),
          },
          { key: "role", header: tr("Role"), cell: (u) => <Badge variant={u.role === "SUPER_ADMIN" ? "default" : u.role === "EDITOR_IN_CHIEF" ? "brand" : "outline"}>{ROLE_LABELS[u.role]}</Badge> },
          { key: "campus", header: tr("Campus"), cell: (u) => (u.role === "CAMPUS_EDITOR" ? u.campusName ? <CampusChip name={u.campusName} colour={u.campusColour} /> : <span className="text-2xs text-warning">{tr("No campus set")}</span> : <span className="text-2xs text-muted-foreground">—</span>) },
          { key: "sessions", header: tr("Sessions"), cell: (u) => <span className="tabular text-xs">{u.activeSessions}</span>, align: "right" },
          { key: "login", header: tr("Last sign-in"), cell: (u) => <span className="text-xs text-muted-foreground" title={u.lastLoginAt ? formatDateTime(u.lastLoginAt) : undefined}>{u.lastLoginAt ? relativeTime(u.lastLoginAt) : "Never"}</span> },
          {
            key: "actions",
            header: "",
            align: "right",
            width: "48px",
            cell: (u) => (
              <span data-no-row-link>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${u.name}`}>
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setEditing({ mode: "edit", user: u })}>
                      <Pencil />{" "}{tr("Edit role & campus")}</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setConfirm({ kind: "reset", user: u })}>
                      <KeyRound />{" "}{tr("Reset password")}</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {u.isActive ? (
                      <DropdownMenuItem variant="destructive" disabled={u.id === currentUserId} onSelect={() => setConfirm({ kind: "deactivate", user: u })}>
                        <UserRoundX />{" "}{tr("Deactivate")}</DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem onSelect={() => run(() => updateUserAction(u.id, { isActive: true }))}>
                        <UserRoundCheck />{" "}{tr("Reactivate")}</DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </span>
            ),
          },
        ]}
      />

      {editing ? (
        <UserDialog
          key={editing.mode === "edit" ? editing.user.id : "create"}
          mode={editing.mode}
          initial={editing.mode === "edit" ? { name: editing.user.name, email: editing.user.email, role: editing.user.role, campusId: editing.user.campusId, isActive: editing.user.isActive } : EMPTY}
          campuses={campuses}
          isSelf={editing.mode === "edit" && editing.user.id === currentUserId}
          onClose={() => setEditing(null)}
          onSubmit={(form) =>
            start(async () => {
              if (editing.mode === "create") {
                const res = await createUserAction(form);
                if (!res.ok) {
                  toast.error(res.error, { description: res.fieldErrors ? Object.values(res.fieldErrors).flat().join(" · ") : undefined });
                  return;
                }
                setEditing(null);
                setSecret({ title: `Temporary password for ${form.name}`, email: res.data.email, password: res.data.temporaryPassword });
                toast.success(res.message);
              } else {
                const res = await updateUserAction(editing.user.id, { name: form.name, role: form.role, campusId: form.campusId, isActive: form.isActive });
                if (!res.ok) {
                  toast.error(res.error);
                  return;
                }
                setEditing(null);
                toast.success(res.message);
              }
              router.refresh();
            })
          }
          pending={pending}
        />
      ) : null}

      <AlertDialog open={!!confirm} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.kind === "reset" ? `Reset the password of ${confirm.user.name}?` : `Deactivate ${confirm?.user.name}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === "reset"
                ? "A new temporary password is generated and shown once. Every session of this user is signed out."
                : "The account can no longer sign in and every active session is closed. Their past work stays attributed to them. You can reactivate later."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tr("Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className={confirm?.kind === "deactivate" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined}
              onClick={() => {
                if (!confirm) return;
                const target = confirm;
                setConfirm(null);
                if (target.kind === "reset") {
                  start(async () => {
                    const res = await resetPasswordAction(target.user.id);
                    if (!res.ok) {
                      toast.error(res.error);
                      return;
                    }
                    setSecret({ title: `Temporary password for ${target.user.name}`, email: target.user.email, password: res.data.temporaryPassword });
                    toast.success(res.message);
                    router.refresh();
                  });
                } else run(() => updateUserAction(target.user.id, { isActive: false }));
              }}
            >
              {confirm?.kind === "reset" ? "Generate password" : "Deactivate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!secret} onOpenChange={(open) => !open && setSecret(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{secret?.title}</DialogTitle>
            <DialogDescription>{tr("Share it over a safe channel. It is shown once and never stored in clear.")}</DialogDescription>
          </DialogHeader>
          {secret ? (
            <div className="space-y-2">
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
                <div className="label-caps">{tr("Email")}</div>
                <div className="font-mono text-xs">{secret.email}</div>
              </div>
              <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="label-caps">{tr("Temporary password")}</div>
                  <div className="font-mono text-sm tracking-wide select-all">{secret.password}</div>
                </div>
                <CopyButton value={secret.password} size="sm" />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button onClick={() => setSecret(null)}>{tr("Done")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function UserDialog({ mode, initial, campuses, isSelf, onClose, onSubmit, pending }: { mode: "create" | "edit"; initial: Form; campuses: Campus[]; isSelf: boolean; onClose: () => void; onSubmit: (form: Form) => void; pending: boolean }) {
  const tr = useUi();
  const [form, setForm] = useState<Form>(initial);
  const [errors] = useState<Record<string, string[]> | null>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const valid = form.name.trim().length >= 2 && /\S+@\S+\.\S+/.test(form.email);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Invite a user" : `Edit ${initial.name}`}</DialogTitle>
          <DialogDescription>{mode === "create" ? "A temporary password is generated and shown once after saving." : "Role changes apply on the next request; deactivating signs the user out."}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) onSubmit(form);
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="user-name">{tr("Name")}</Label>
              <Input id="user-name" value={form.name} onChange={(e) => set("name", e.target.value)} autoFocus />
              <FieldError errors={errors} name="name" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="user-email">{tr("Email")}</Label>
              <Input id="user-email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} disabled={mode === "edit"} />
              <FieldError errors={errors} name="email" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="user-role">{tr("Role")}</Label>
              <NativeSelect id="user-role" value={form.role} onChange={(e) => set("role", e.target.value as Role)} disabled={isSelf}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </NativeSelect>
              <p className="text-2xs text-muted-foreground">{ROLE_DESCRIPTIONS[form.role]}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="user-campus">{tr("Campus")}</Label>
              <NativeSelect id="user-campus" value={form.campusId ?? ""} onChange={(e) => set("campusId", e.target.value || null)}>
                <option value="">{form.role === "CAMPUS_EDITOR" ? "Choose a campus…" : "School-wide"}</option>
                {campuses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
              {form.role === "CAMPUS_EDITOR" && !form.campusId ? <p className="text-2xs text-warning">{tr("Campus editors review submissions for one campus.")}</p> : null}
            </div>
          </div>
          {mode === "edit" ? (
            <label className="flex items-center justify-between rounded-md border px-3 py-2 text-[13px]">
              <span>{tr("Active account")}</span>
              <Switch checked={form.isActive} onCheckedChange={(v) => set("isActive", v)} disabled={isSelf} />
            </label>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {tr("Cancel")}</Button>
            <Button type="submit" loading={pending} disabled={!valid}>
              {mode === "create" ? "Invite & generate password" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
