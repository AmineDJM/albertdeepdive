import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getUi } from "@/server/i18n/locale";

/** Server-rendered pager: builds `?page=` links that keep the other search params. */
export async function MediaPagination({
  page,
  pageCount,
  total,
  pageSize,
  basePath,
  params,
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  basePath: string;
  params: Record<string, string | undefined>;
}) {
  const tr = await getUi();
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  const href = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v && k !== "page") sp.set(k, v);
    if (p > 1) sp.set("page", String(p));
    const qs = sp.toString();
    return `${basePath}${qs ? `?${qs}` : ""}`;
  };
  return (
    <nav
      className="text-muted-foreground flex items-center justify-between gap-3 text-xs"
      aria-label={tr("Pagination")}
    >
      <span className="tabular">
        {total ? `${from}–${to} of ${total}` : "0"}{" "}{tr("asset")}{total === 1 ? "" : "s"}
      </span>
      {pageCount > 1 ? (
        <div className="flex items-center gap-1.5">
          {page > 1 ? (
            <Button asChild variant="outline" size="sm">
              <Link href={href(page - 1)} rel="prev" aria-label={tr("Previous page")}>
                <ChevronLeft />{" "}{tr("Prev")}</Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled aria-label={tr("Previous page")}>
              <ChevronLeft />{" "}{tr("Prev")}</Button>
          )}
          <span className="tabular px-1">
            {tr("Page")}{" "}{page} / {pageCount}
          </span>
          {page < pageCount ? (
            <Button asChild variant="outline" size="sm">
              <Link href={href(page + 1)} rel="next" aria-label={tr("Next page")}>
                {tr("Next")}{" "}<ChevronRight />
              </Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled aria-label={tr("Next page")}>
              {tr("Next")}{" "}<ChevronRight />
            </Button>
          )}
        </div>
      ) : null}
    </nav>
  );
}
