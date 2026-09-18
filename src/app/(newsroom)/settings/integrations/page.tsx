import { redirect } from "next/navigation";

/** Integrations are platform configuration, not workspace settings; old links still land there. */
export default function MovedIntegrations() {
  redirect("/admin/providers");
}
