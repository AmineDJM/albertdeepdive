import { LibraryScreen } from "@/app/(newsroom)/library/page";
import { hubPublication } from "../newsletter-hub";

export const dynamic = "force-dynamic";

/** The newsletter's own library: its pictures, and the organisation's shared ones. */
export default async function NewsletterLibraryPage({ params, searchParams }: { params: Promise<{ publicationId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { publicationId } = await params;
  const [publication, raw] = await Promise.all([hubPublication(publicationId), searchParams]);
  return <LibraryScreen raw={raw} publication={publication} />;
}
