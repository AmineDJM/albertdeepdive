import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";

export type Column<T> = { key: string; header: React.ReactNode; cell: (row: T) => React.ReactNode; className?: string; align?: "left" | "right" | "center"; width?: string };

export function DataTable<T>({ rows, columns, rowKey, empty, className, onRowHref, dense = false }: { rows: T[]; columns: Column<T>[]; rowKey: (row: T) => string; empty?: { title: string; description?: React.ReactNode; action?: React.ReactNode; icon?: React.ComponentType<{ className?: string }> }; className?: string; onRowHref?: (row: T) => string | undefined; dense?: boolean }) {
  if (!rows.length && empty) {
    return <EmptyState title={empty.title} description={empty.description} action={empty.action} icon={empty.icon} compact />;
  }
  return (
    <div className={cn("overflow-hidden rounded-lg border border-border bg-card", className)}>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map((c) => (
              <TableHead key={c.key} className={cn(c.className, c.align === "right" && "text-right", c.align === "center" && "text-center")} style={c.width ? { width: c.width } : undefined}>
                {c.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const href = onRowHref?.(row);
            return (
              <TableRow key={rowKey(row)} className={cn(href && "cursor-pointer")} data-href={href}>
                {columns.map((c) => (
                  <TableCell key={c.key} className={cn(dense && "py-1.5", c.className, c.align === "right" && "text-right", c.align === "center" && "text-center")}>
                    {c.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
