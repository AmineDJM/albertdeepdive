"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUi } from "@/components/i18n/provider";

export default function NewsroomError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const tr = useUi();
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="flex flex-1 items-center justify-center p-10">
      <div className="max-w-md rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center">
        <AlertTriangle className="mx-auto size-6 text-destructive" />
        <h2 className="mt-3 text-sm font-semibold">{tr("Something went wrong")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{error.message || "An unexpected error occurred."}</p>
        {error.digest ? <p className="mt-1 font-mono text-2xs text-muted-foreground">{error.digest}</p> : null}
        <Button className="mt-4" variant="outline" onClick={reset}>
          {tr("Try again")}</Button>
      </div>
    </div>
  );
}
