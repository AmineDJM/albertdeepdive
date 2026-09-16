import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col">
      <div className="flex h-12 items-center justify-between border-b px-5">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-8 w-40" />
      </div>
      <div className="flex h-10 items-center gap-2 border-b px-5">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-5 w-20" />
        ))}
      </div>
      <div className="flex h-12 items-center gap-2 border-b px-5">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-8 w-32" />
      </div>
      <div className="space-y-4 p-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-[74px]" />
          ))}
        </div>
        <Skeleton className="h-10" />
        <div className="overflow-hidden rounded-lg border border-border">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} className="h-9 rounded-none border-b border-border last:border-0" />
          ))}
        </div>
      </div>
    </div>
  );
}
