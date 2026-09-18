import { redirect } from "next/navigation";

/** The media library grew into the Library; old links still land there. */
export default function Redirect() {
  redirect("/library");
}
