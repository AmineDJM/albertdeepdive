import { redirect } from "next/navigation";

const RENAMED: Record<string, string> = { workspaces: "organizations", people: "users", payments: "billing", integrations: "providers", logs: "audit" };

/** Every old console path lands on its new name under /admin. */
export default async function MovedConsolePage({ params }: { params: Promise<{ rest: string[] }> }) {
  const { rest } = await params;
  const [head, ...tail] = rest;
  redirect(`/admin/${[RENAMED[head] ?? head, ...tail].join("/")}`);
}
