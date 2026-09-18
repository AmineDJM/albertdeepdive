"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Languages } from "lucide-react";
import { toast } from "sonner";
import { setLocaleAction } from "@/app/(platform)/settings/profile/actions";
import { NativeSelect } from "@/components/ui/native-select";
import { useLocale } from "./provider";
import { LOCALES, LOCALE_LABELS, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * A person's own interface language.
 *
 * Separate from the workspace's language and from a publication's: an English-speaking editor at a
 * French organisation should be able to read the app in English without changing anything for their
 * colleagues or their readers.
 */
export function LanguagePicker({ className }: { className?: string }) {
  const router = useRouter();
  const locale = useLocale();
  const [pending, startTransition] = useTransition();

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <Languages className="size-3.5 shrink-0 text-muted-foreground" />
      <NativeSelect
        aria-label="Interface language"
        value={locale}
        disabled={pending}
        className="h-7 w-[112px] text-xs"
        onChange={(e) => {
          const next = e.target.value as Locale;
          startTransition(async () => {
            const result = await setLocaleAction(next);
            if (!result.ok) toast.error(result.error);
            router.refresh();
          });
        }}
      >
        {LOCALES.map((value) => (
          <option key={value} value={value}>
            {LOCALE_LABELS[value]}
          </option>
        ))}
      </NativeSelect>
    </span>
  );
}
