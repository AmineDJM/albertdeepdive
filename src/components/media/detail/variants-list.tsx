import { Download, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { MediaVariantView } from "@/server/media/library";
import { formatBytes } from "@/server/media/constants";
import { getUi } from "@/server/i18n/locale";

const KIND_LABEL: Record<MediaVariantView["kind"], string> = {
  THUMBNAIL: "Thumbnail",
  WEB: "Web",
  PRINT: "Print",
  CROP: "Crop",
};
const KIND_HINT: Record<MediaVariantView["kind"], string> = {
  THUMBNAIL: "480 px · library and pickers",
  WEB: "1600 px · digital edition and previews",
  PRINT: "2600 px · PDF and DOCX export",
  CROP: "editorial crop from the original",
};

type Row = {
  key: string;
  label: string;
  hint: string;
  width: number | null;
  height: number | null;
  format: string;
  sizeBytes: number;
  url: string;
  downloadUrl: string;
};

export async function VariantsList({
  original,
  variants,
}: {
  original: {
    url: string;
    downloadUrl: string;
    width: number | null;
    height: number | null;
    format: string | null;
    sizeBytes: number;
  };
  variants: MediaVariantView[];
}) {
  const tr = await getUi();
  const rows: Row[] = [
    {
      key: "original",
      label: tr("Original"),
      hint: tr("untouched upload · never altered"),
      width: original.width,
      height: original.height,
      format: original.format ?? "",
      sizeBytes: original.sizeBytes,
      url: original.url,
      downloadUrl: original.downloadUrl,
    },
    ...variants.map((v) => ({
      key: v.id,
      label: KIND_LABEL[v.kind],
      hint: KIND_HINT[v.kind],
      width: v.width,
      height: v.height,
      format: v.format,
      sizeBytes: v.sizeBytes,
      url: v.url,
      downloadUrl: v.downloadUrl,
    })),
  ];
  return (
    <div className="border-border bg-card overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>{tr("Variant")}</TableHead>
            <TableHead className="text-right">{tr("Dimensions")}</TableHead>
            <TableHead>{tr("Format")}</TableHead>
            <TableHead className="text-right">{tr("Size")}</TableHead>
            <TableHead className="w-24" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.key}>
              <TableCell className="py-1.5">
                <div className="font-medium">{r.label}</div>
                <div className="text-2xs text-muted-foreground">{r.hint}</div>
              </TableCell>
              <TableCell className="tabular py-1.5 text-right text-xs">
                {r.width && r.height ? `${r.width}×${r.height}` : "—"}
              </TableCell>
              <TableCell className="py-1.5 text-xs uppercase">{r.format}</TableCell>
              <TableCell className="tabular py-1.5 text-right text-xs">
                {formatBytes(r.sizeBytes)}
              </TableCell>
              <TableCell className="py-1.5">
                <div className="flex justify-end gap-0.5">
                  <Button asChild variant="ghost" size="icon-xs" aria-label={`Open ${r.label}`}>
                    <a href={r.url} target="_blank" rel="noreferrer">
                      <ExternalLink />
                    </a>
                  </Button>
                  <Button asChild variant="ghost" size="icon-xs" aria-label={`Download ${r.label}`}>
                    <a href={r.downloadUrl}>
                      <Download />
                    </a>
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
