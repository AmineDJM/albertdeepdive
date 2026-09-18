import { PageBody, PageHeader } from "@/components/newsroom/page-header";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <PageHeader title="Audio" />
      <PageBody className="space-y-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-48 w-full" />
      </PageBody>
    </>
  );
}
