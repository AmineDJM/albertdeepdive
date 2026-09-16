import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col">
      <div className="flex h-12 items-center justify-between border-b px-5">
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-8 w-28" />
      </div>
      <div className="max-w-6xl space-y-6 p-5">
        <Skeleton className="h-52" />
        <Skeleton className="h-72" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-40" />
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
        <Skeleton className="h-56" />
      </div>
    </div>
  );
}
