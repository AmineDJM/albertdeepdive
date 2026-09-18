"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, ImagePlus, Trash2, Upload, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { RIGHTS_STATUS_LABELS } from "@/lib/constants";
import type { StoryPickerItem } from "@/server/media/library";
import type { UploadedAsset } from "@/server/media/upload";
import {
  formatBytes,
  KIND_LABELS,
  LOW_QUALITY_THRESHOLD,
  MEDIA_KINDS,
  RIGHTS_STATUSES,
  ROLE_LABELS,
  STORY_MEDIA_ROLES,
  type MediaKind,
  type RightsStatus,
  type StoryMediaRole,
} from "@/server/media/constants";
import { useUi } from "@/components/i18n/provider";

type QueuedFile = {
  key: string;
  file: File;
  previewUrl: string;
  caption: string;
  photographer: string;
  credit: string;
  rightsStatus: RightsStatus;
  kind: MediaKind | "";
  status: "queued" | "uploading" | "done" | "error";
  progress: number;
  error?: string;
  result?: UploadedAsset;
};

const ACCEPT = "image/jpeg,image/png,image/webp,image/gif,image/tiff,image/avif";

function guessKind(name: string): MediaKind | "" {
  const n = name.toLowerCase();
  if (/logo/.test(n)) return "logo";
  if (/screenshot|dashboard|screen/.test(n)) return "screenshot";
  if (/diagram|schema|flow/.test(n)) return "diagram";
  if (/chart|graph|plot/.test(n)) return "chart";
  return "";
}

function uploadOne(
  item: QueuedFile,
  fields: Record<string, string>,
  onProgress: (pct: number) => void,
): Promise<UploadedAsset> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", item.file, item.file.name);
    for (const [k, v] of Object.entries(fields)) if (v) form.append(k, v);
    if (item.caption.trim()) form.append("caption", item.caption.trim());
    if (item.photographer.trim()) form.append("photographer", item.photographer.trim());
    if (item.credit.trim()) form.append("credit", item.credit.trim());
    form.append("rightsStatus", item.rightsStatus);
    if (item.kind) form.append("kind", item.kind);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/uploads");
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.onload = () => {
      const body = xhr.response as { assets?: UploadedAsset[]; error?: string } | null;
      if (xhr.status >= 200 && xhr.status < 300 && body?.assets?.[0]) resolve(body.assets[0]);
      else reject(new Error(body?.error ?? `Upload failed (${xhr.status})`));
    };
    xhr.send(form);
  });
}

export function UploadDialog({
  editionId,
  stories,
  defaultStoryId,
  maxFileMb,
}: {
  editionId: string;
  stories: StoryPickerItem[];
  defaultStoryId?: string | null;
  maxFileMb: number;
}) {
  const tr = useUi();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<QueuedFile[]>([]);
  const [storyId, setStoryId] = useState(defaultStoryId ?? "");
  const [role, setRole] = useState<StoryMediaRole>("gallery");
  const [sharedPhotographer, setSharedPhotographer] = useState("");
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // Release the object URLs of whatever is still staged when the dialog unmounts.
  useEffect(() => {
    return () => {
      for (const item of itemsRef.current) URL.revokeObjectURL(item.previewUrl);
    };
  }, []);

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const max = maxFileMb * 1024 * 1024;
      const next: QueuedFile[] = [];
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) {
          toast.error(`${file.name}: not an image`);
          continue;
        }
        const tooBig = file.size > max;
        next.push({
          key: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 7)}`,
          file,
          previewUrl: URL.createObjectURL(file),
          caption: "",
          photographer: sharedPhotographer,
          credit: sharedPhotographer ? `© ${sharedPhotographer}` : "",
          rightsStatus: "YELLOW",
          kind: guessKind(file.name),
          status: tooBig ? "error" : "queued",
          progress: 0,
          error: tooBig ? `Larger than ${maxFileMb} MB` : undefined,
        });
      }
      setItems((prev) => [...prev, ...next]);
    },
    [maxFileMb, sharedPhotographer],
  );

  const update = (key: string, patch: Partial<QueuedFile>) =>
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  const remove = (key: string) =>
    setItems((prev) => {
      const item = prev.find((it) => it.key === key);
      if (item) URL.revokeObjectURL(item.previewUrl);
      return prev.filter((it) => it.key !== key);
    });

  const queued = useMemo(() => items.filter((it) => it.status === "queued"), [items]);
  const done = useMemo(() => items.filter((it) => it.status === "done"), [items]);

  async function start() {
    if (!queued.length) return;
    setUploading(true);
    let ok = 0;
    let failed = 0;
    for (const item of queued) {
      update(item.key, { status: "uploading", progress: 0 });
      try {
        const result = await uploadOne(
          item,
          { editionId, storyId, role: storyId ? role : "" },
          (pct) => update(item.key, { progress: pct }),
        );
        update(item.key, { status: "done", progress: 100, result });
        ok += 1;
      } catch (err) {
        update(item.key, {
          status: "error",
          error: err instanceof Error ? err.message : "Upload failed",
        });
        failed += 1;
      }
    }
    setUploading(false);
    if (ok)
      toast.success(
        `${ok} file${ok === 1 ? "" : "s"} uploaded${failed ? ` · ${failed} failed` : ""}`,
        { description: tr("AI description and duplicate check run in the background.") },
      );
    else if (failed) toast.error(`${failed} upload${failed === 1 ? "" : "s"} failed`);
    router.refresh();
  }

  function onOpenChange(next: boolean) {
    if (!next && uploading) return;
    setOpen(next);
    if (!next) {
      for (const item of items) URL.revokeObjectURL(item.previewUrl);
      setItems([]);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Upload />{" "}{tr("Upload")}</Button>
      </DialogTrigger>
      <DialogContent size="xl" className="max-h-[92vh] overflow-hidden p-0">
        <div className="flex max-h-[92vh] flex-col">
          <DialogHeader className="px-5 pt-5">
            <DialogTitle>{tr("Upload media")}</DialogTitle>
            <DialogDescription>
              {tr("JPEG, PNG, WebP, GIF, TIFF or AVIF, up to")}{" "}{maxFileMb}{" "}{tr("MB each. Rights default to “Unclear” until you confirm them.")}</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 scrollbar-thin space-y-4 overflow-y-auto px-5 py-4">
            <div
              role="button"
              tabIndex={0}
              aria-label={tr("Add files")}
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  inputRef.current?.click();
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
              }}
              className={cn(
                "focus-visible:ring-ring/50 flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed px-4 py-7 text-center transition-colors focus-visible:ring-2 focus-visible:outline-none",
                dragging
                  ? "border-brand bg-brand-soft/40"
                  : "border-border bg-muted/40 hover:bg-muted/70",
              )}
            >
              <UploadCloud className="text-muted-foreground size-5" />
              <div className="text-[13px] font-medium">{tr("Drop images here, or click to browse")}</div>
              <div className="text-2xs text-muted-foreground">
                {tr("Several files at once are fine — each gets its own caption, credit and rights.")}</div>
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPT}
                multiple
                className="sr-only"
                onChange={(e) => e.target.files && addFiles(e.target.files)}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="upload-story">{tr("Attach to a story (optional)")}</Label>
                <NativeSelect
                  id="upload-story"
                  value={storyId}
                  onChange={(e) => setStoryId(e.target.value)}
                >
                  <option value="">{tr("— No story —")}</option>
                  {stories.map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.title}
                      {st.sectionName ? ` · ${st.sectionName}` : ""}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="upload-role">{tr("Role")}</Label>
                <NativeSelect
                  id="upload-role"
                  value={role}
                  disabled={!storyId}
                  onChange={(e) => setRole(e.target.value as StoryMediaRole)}
                >
                  {STORY_MEDIA_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-1.5 sm:col-span-3">
                <Label htmlFor="upload-photographer">{tr("Photographer for all files (optional)")}</Label>
                <Input
                  id="upload-photographer"
                  value={sharedPhotographer}
                  placeholder={tr("Applied to every queued file without a photographer")}
                  onChange={(e) => {
                    const v = e.target.value;
                    setSharedPhotographer(v);
                    setItems((prev) =>
                      prev.map((it) =>
                        it.status === "queued" &&
                        (!it.photographer || it.photographer === sharedPhotographer)
                          ? {
                              ...it,
                              photographer: v,
                              credit:
                                !it.credit || it.credit === `© ${sharedPhotographer}`
                                  ? v
                                    ? `© ${v}`
                                    : ""
                                  : it.credit,
                            }
                          : it,
                      ),
                    );
                  }}
                />
              </div>
            </div>

            {items.length ? (
              <ul className="space-y-2" aria-label={tr("Files to upload")}>
                {items.map((it) => (
                  <li
                    key={it.key}
                    className={cn(
                      "border-border bg-card grid gap-3 rounded-lg border p-2.5 sm:grid-cols-[88px_minmax(0,1fr)]",
                      it.status === "error" && "border-destructive/40",
                    )}
                  >
                    <div className="bg-muted relative aspect-[4/3] overflow-hidden rounded sm:aspect-square">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={it.result?.thumbUrl ?? it.previewUrl}
                        alt=""
                        className="size-full object-cover"
                      />
                    </div>
                    <div className="min-w-0 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-[13px] font-medium">{it.file.name}</div>
                          <div className="text-2xs text-muted-foreground">
                            {formatBytes(it.file.size)}
                            {it.result ? ` · ${it.result.width}×${it.result.height}` : ""}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {it.status === "done" && it.result ? (
                            <>
                              {it.result.qualityScore !== null &&
                              it.result.qualityScore < LOW_QUALITY_THRESHOLD ? (
                                <Badge variant="amber">Q {it.result.qualityScore}</Badge>
                              ) : null}
                              {it.result.duplicateOfId ? (
                                <Badge variant="red">
                                  <AlertTriangle />{" "}{tr("duplicate")}</Badge>
                              ) : null}
                              <Badge variant="success">
                                <CheckCircle2 />{" "}{tr("Uploaded")}</Badge>
                            </>
                          ) : it.status === "error" ? (
                            <Badge variant="destructive">{it.error ?? "Failed"}</Badge>
                          ) : null}
                          {it.status === "queued" || it.status === "error" ? (
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              aria-label={`Remove ${it.file.name}`}
                              onClick={() => remove(it.key)}
                            >
                              <Trash2 />
                            </Button>
                          ) : null}
                        </div>
                      </div>
                      {it.status === "uploading" ? (
                        <Progress value={it.progress} aria-label={`Uploading ${it.file.name}`} />
                      ) : null}
                      {it.status === "queued" ? (
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_120px_120px]">
                          <Input
                            aria-label={tr("Caption")}
                            placeholder={tr("Caption")}
                            value={it.caption}
                            onChange={(e) => update(it.key, { caption: e.target.value })}
                            className="h-7 text-xs"
                          />
                          <Input
                            aria-label={tr("Photographer")}
                            placeholder={tr("Photographer")}
                            value={it.photographer}
                            onChange={(e) =>
                              update(it.key, {
                                photographer: e.target.value,
                                credit:
                                  !it.credit || it.credit === `© ${it.photographer}`
                                    ? e.target.value
                                      ? `© ${e.target.value}`
                                      : ""
                                    : it.credit,
                              })
                            }
                            className="h-7 text-xs"
                          />
                          <Input
                            aria-label={tr("Credit")}
                            placeholder={tr("© Credit")}
                            value={it.credit}
                            onChange={(e) => update(it.key, { credit: e.target.value })}
                            className="h-7 text-xs"
                          />
                          <NativeSelect
                            aria-label={tr("Rights")}
                            value={it.rightsStatus}
                            onChange={(e) =>
                              update(it.key, { rightsStatus: e.target.value as RightsStatus })
                            }
                            className="h-7 text-xs"
                          >
                            {RIGHTS_STATUSES.map((st) => (
                              <option key={st} value={st}>
                                {RIGHTS_STATUS_LABELS[st]}
                              </option>
                            ))}
                          </NativeSelect>
                          <NativeSelect
                            aria-label={tr("Kind")}
                            value={it.kind}
                            onChange={(e) =>
                              update(it.key, { kind: e.target.value as MediaKind | "" })
                            }
                            className="h-7 text-xs"
                          >
                            <option value="">{tr("Auto-detect")}</option>
                            {MEDIA_KINDS.map((k) => (
                              <option key={k} value={k}>
                                {KIND_LABELS[k]}
                              </option>
                            ))}
                          </NativeSelect>
                        </div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-muted-foreground flex items-center gap-2 text-xs">
                <ImagePlus className="size-3.5" />{" "}{tr("No files queued yet.")}</div>
            )}
          </div>
          <DialogFooter className="border-t px-5 py-3">
            <span className="text-2xs text-muted-foreground mr-auto self-center">
              {queued.length ? `${queued.length} ready` : ""}
              {done.length ? `${queued.length ? " · " : ""}${done.length} uploaded` : ""}
            </span>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={uploading}>
              {done.length && !queued.length ? "Done" : "Cancel"}
            </Button>
            <Button onClick={start} disabled={!queued.length} loading={uploading}>
              <Upload />{" "}{tr("Upload")}{" "}
              {queued.length ? `${queued.length} file${queued.length === 1 ? "" : "s"}` : ""}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
