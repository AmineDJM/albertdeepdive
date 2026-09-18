import { redirect } from "next/navigation";

/** The console moved to /admin; the old door still opens onto it. */
export default function MovedConsole() {
  redirect("/admin");
}
