import { redirect } from "next/navigation";

/** The platform console left workspace settings for its own area; old links still land there. */
export default function MovedPlatform() {
  redirect("/platform");
}
