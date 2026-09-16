import { Skeleton } from "@/components/ui/skeleton";

export default function SettingsLoading() {
  return (
    <div className="flex flex-col">
      <div className="flex h-12 items-center border-b px-5">
        <Skeleton className="h-4 w-36" />
      </div>
      <div className="max-w-3xl space-y-4 p-5">
        <Skeleton className="h-40" />
        <Skeleton className="h-56" />
        <Skeleton className="h-32" />
      </div>
    </div>
  );
}
