import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col">
      <div className="flex h-12 items-center justify-between border-b px-5">
        <Skeleton className="h-4 w-48" />
      </div>
      <div className="mx-auto w-full max-w-5xl space-y-4 p-5">
        <Skeleton className="h-6 w-64" />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    </div>
  );
}
