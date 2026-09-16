import { redirect } from "next/navigation";
import { getCurrentEdition } from "@/server/editions/service";

export default async function Redirect() {
  const current = await getCurrentEdition();
  redirect(current ? `/editions/${current.id}/stories` : "/editions");
}
