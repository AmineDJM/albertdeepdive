"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Makes table rows with data-href navigable (click + Enter) without wrapping cells in anchors. */
export function RowLinkBehaviour() {
  const router = useRouter();
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (target.closest("a, button, input, select, textarea, [role=menuitem], [data-no-row-link]")) return;
      const row = target.closest<HTMLElement>("tr[data-href]");
      const href = row?.dataset.href;
      if (href) router.push(href);
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [router]);
  return null;
}
