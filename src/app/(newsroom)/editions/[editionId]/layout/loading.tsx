import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col">
      <div className="flex h-12 items-center justify-between border-b border-border px-5">
        <Skeleton className="h-4 w-56" />
        <div className="flex gap-2">
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-8 w-28" />
        </div>
      </div>
      <div className="space-y-4 p-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[74px]" />
          ))}
        </div>
        <Skeleton className="h-[126px]" />
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_272px]">
          <div className="grid gap-3 2xl:grid-cols-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-lg border border-border/70 bg-muted/20 p-2">
                <Skeleton className="mb-1.5 h-3 w-24" />
                <div className="grid grid-cols-2 gap-1">
                  {Array.from({ length: 2 }).map((_, j) => (
                    <div key={j} className="rounded-lg border border-border bg-card p-1.5">
                      <Skeleton className="aspect-[210/297] rounded-sm" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-4">
            <Skeleton className="h-64" />
            <Skeleton className="h-32" />
          </div>
        </div>
      </div>
    </div>
  );
}
