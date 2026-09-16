"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { FileAudio, FileText, ImagePlus, Loader2, Mic, Paperclip, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import type { AttachmentDTO } from "@/lib/submissions/dto";
import { cn } from "@/lib/utils";
import { contributeApi, ContributeApiError } from "./api";
import { SectionTitle } from "./fields";

export type UploadLimits = { maxFileMb: number; maxFiles: number };

type PendingUpload = { localId: string; name: string; sizeBytes: number; isImage: boolean; progress: number; error: string | null; previewUrl: string | null; file: File };

const PHOTO_ACCEPT = "image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif";
const DOCUMENT_ACCEPT = ".pdf,.docx,.pptx,.xlsx,.csv,.txt,application/pdf";
const AUDIO_ACCEPT = "audio/*,.mp3,.m4a,.wav,.webm,.ogg";

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UploadZone({
  token,
  ensureDraft,
  attachments,
  onAttachmentsChange,
  limits,
  disabled,
  onError,
}: {
  token: string;
  ensureDraft: () => Promise<string>;
  attachments: AttachmentDTO[];
  onAttachmentsChange: (next: AttachmentDTO[]) => void;
  limits: UploadLimits;
  disabled?: boolean;
  onError?: (message: string) => void;
}) {
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [dragging, setDragging] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const docInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const attachmentsRef = useRef(attachments);
  const pendingRef = useRef(pending);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);
  // Release object URLs of previews that never finished when the step unmounts.
  useEffect(() => {
    return () => {
      for (const p of pendingRef.current) if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
    };
  }, []);

  const updatePending = (localId: string, patch: Partial<PendingUpload>) => setPending((list) => list.map((p) => (p.localId === localId ? { ...p, ...patch } : p)));

  const startUpload = useCallback(
    async (item: PendingUpload) => {
      try {
        const submissionId = await ensureDraft();
        const { attachment } = await contributeApi.upload(token, submissionId, item.file, { onProgress: (fraction) => updatePending(item.localId, { progress: fraction }) });
        onAttachmentsChange([...attachmentsRef.current, attachment]);
        setPending((list) => list.filter((p) => p.localId !== item.localId));
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      } catch (err) {
        const message = err instanceof ContributeApiError ? err.message : "The upload failed. Please try again.";
        updatePending(item.localId, { error: message, progress: 0 });
      }
    },
    [ensureDraft, onAttachmentsChange, token],
  );

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const list = Array.from(files);
      if (!list.length) return;
      const room = limits.maxFiles - attachmentsRef.current.length - pending.length;
      if (room <= 0) {
        onError?.(`You can attach up to ${limits.maxFiles} files per story.`);
        return;
      }
      const accepted = list.slice(0, room);
      if (accepted.length < list.length) onError?.(`Only ${room} more ${room === 1 ? "file fits" : "files fit"} — up to ${limits.maxFiles} per story.`);
      const items: PendingUpload[] = accepted.map((file) => {
        const isImage = file.type.startsWith("image/");
        const tooBig = file.size > limits.maxFileMb * 1024 * 1024;
        return {
          localId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: file.name,
          sizeBytes: file.size,
          isImage,
          progress: 0,
          error: tooBig ? `Larger than ${limits.maxFileMb} MB — please resize or compress it.` : file.size === 0 ? "This file is empty." : null,
          previewUrl: isImage ? URL.createObjectURL(file) : null,
          file,
        };
      });
      setPending((current) => [...current, ...items]);
      for (const item of items) if (!item.error) void startUpload(item);
    },
    [limits.maxFileMb, limits.maxFiles, onError, pending.length, startUpload],
  );

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    addFiles(event.dataTransfer.files);
  };

  const remove = async (attachment: AttachmentDTO) => {
    onAttachmentsChange(attachmentsRef.current.filter((a) => a.id !== attachment.id));
    try {
      const submissionId = await ensureDraft();
      await contributeApi.removeUpload(token, submissionId, attachment.id);
    } catch (err) {
      onAttachmentsChange([...attachmentsRef.current, attachment]);
      onError?.(err instanceof ContributeApiError ? err.message : "Could not remove the file.");
    }
  };

  const saveMeta = async (attachment: AttachmentDTO, meta: { caption?: string; photographer?: string }) => {
    const current = attachmentsRef.current.find((a) => a.id === attachment.id);
    if (!current) return;
    if ((meta.caption ?? current.caption ?? "") === (current.caption ?? "") && (meta.photographer ?? current.photographer ?? "") === (current.photographer ?? "")) return;
    onAttachmentsChange(attachmentsRef.current.map((a) => (a.id === attachment.id ? { ...a, caption: meta.caption ?? a.caption, photographer: meta.photographer ?? a.photographer } : a)));
    try {
      const submissionId = await ensureDraft();
      await contributeApi.updateUpload(token, submissionId, attachment.id, meta);
    } catch (err) {
      onError?.(err instanceof ContributeApiError ? err.message : "Could not save the caption.");
    }
  };

  const photos = attachments.filter((a) => a.kind === "IMAGE");
  const files = attachments.filter((a) => a.kind !== "IMAGE");
  const total = attachments.length + pending.length;

  return (
    <section className="space-y-5" aria-labelledby="uploads-title">
      <SectionTitle description="Team photos, the jury, dashboards, a logo, a poster, a PDF — or a voice note if typing is a pain. Nearly every photo in the paper has a caption and a © credit.">
        <span id="uploads-title">Photos &amp; files</span>
      </SectionTitle>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "rounded-xl border-2 border-dashed p-4 transition-colors sm:p-5",
          dragging ? "border-brand bg-brand-soft" : "border-border bg-card",
          disabled && "opacity-60",
        )}
      >
        <input ref={photoInput} type="file" accept={PHOTO_ACCEPT} multiple hidden onChange={(e) => e.target.files && addFiles(e.target.files)} onClick={(e) => ((e.target as HTMLInputElement).value = "")} />
        <input ref={docInput} type="file" accept={DOCUMENT_ACCEPT} multiple hidden onChange={(e) => e.target.files && addFiles(e.target.files)} onClick={(e) => ((e.target as HTMLInputElement).value = "")} />
        <input ref={audioInput} type="file" accept={AUDIO_ACCEPT} hidden onChange={(e) => e.target.files && addFiles(e.target.files)} onClick={(e) => ((e.target as HTMLInputElement).value = "")} />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <UploadButton icon={ImagePlus} label="Add photos" hint="JPEG, PNG, WebP" onClick={() => photoInput.current?.click()} disabled={disabled || total >= limits.maxFiles} primary />
          <UploadButton icon={Paperclip} label="Add a document" hint="PDF, Word, slides, CSV" onClick={() => docInput.current?.click()} disabled={disabled || total >= limits.maxFiles} />
          <UploadButton icon={Mic} label="Add a voice note" hint="Tell the story out loud" onClick={() => audioInput.current?.click()} disabled={disabled || total >= limits.maxFiles} />
        </div>
        <p className="mt-3 text-center text-[13px] text-muted-foreground">
          Drag files here, too. Up to {limits.maxFiles} files, {limits.maxFileMb} MB each. {total ? `${total} of ${limits.maxFiles} used.` : ""}
        </p>
      </div>

      {pending.length ? (
        <ul className="space-y-2" aria-label="Uploads in progress">
          {pending.map((item) => (
            <li key={item.localId} className="flex items-center gap-3 rounded-lg border border-border bg-card p-2.5">
              {item.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.previewUrl} alt="" className="size-14 shrink-0 rounded-md object-cover" />
              ) : (
                <span className="flex size-14 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">{item.error ? <FileText className="size-5" /> : <Loader2 className="size-5 animate-spin" />}</span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium">{item.name}</p>
                {item.error ? (
                  <p className="text-[13px] text-destructive" role="alert">
                    {item.error}
                  </p>
                ) : (
                  <div className="mt-1.5 flex items-center gap-2">
                    <Progress value={Math.round(item.progress * 100)} aria-label={`Uploading ${item.name}`} className="h-1.5" />
                    <span className="tabular w-10 shrink-0 text-right text-xs text-muted-foreground">{Math.round(item.progress * 100)}%</span>
                  </div>
                )}
              </div>
              {item.error ? (
                <button type="button" onClick={() => setPending((list) => list.filter((p) => p.localId !== item.localId))} className="focus-ring flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted" aria-label={`Dismiss ${item.name}`}>
                  <X className="size-4" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {photos.length ? (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-label="Photos">
          {photos.map((photo) => (
            <li key={photo.id} className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="relative aspect-[4/3] bg-muted">
                {photo.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photo.thumbnailUrl} alt={photo.caption ?? photo.fileName} className="size-full object-cover" />
                ) : null}
                <button
                  type="button"
                  onClick={() => remove(photo)}
                  disabled={disabled}
                  className="focus-ring absolute top-2 right-2 flex size-9 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm hover:bg-background"
                  aria-label={`Remove ${photo.fileName}`}
                >
                  <X className="size-4" />
                </button>
              </div>
              <div className="space-y-2 p-3">
                <PhotoMetaInput label="Caption" placeholder="Who, what, where" defaultValue={photo.caption ?? ""} onCommit={(caption) => saveMeta(photo, { caption })} disabled={disabled} />
                <PhotoMetaInput label="Photo by" placeholder="Photographer's full name" defaultValue={photo.photographer ?? ""} onCommit={(photographer) => saveMeta(photo, { photographer })} disabled={disabled} />
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {files.length ? (
        <ul className="space-y-2" aria-label="Documents and voice notes">
          {files.map((file) => (
            <li key={file.id} className="flex items-center gap-3 rounded-lg border border-border bg-card p-2.5">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">{file.kind === "AUDIO" ? <FileAudio className="size-5" /> : <FileText className="size-5" />}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium">{file.fileName}</p>
                <p className="text-xs text-muted-foreground">
                  {file.kind === "AUDIO" ? "Voice note" : "Document"} · {formatSize(file.sizeBytes)}
                </p>
              </div>
              <button type="button" onClick={() => remove(file)} disabled={disabled} className="focus-ring flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Remove ${file.fileName}`}>
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function UploadButton({ icon: Icon, label, hint, onClick, disabled, primary }: { icon: typeof ImagePlus; label: string; hint: string; onClick: () => void; disabled?: boolean; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "focus-ring flex min-h-14 items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 sm:flex-col sm:items-center sm:justify-center sm:py-4 sm:text-center",
        primary ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90" : "border-border bg-background hover:bg-muted",
      )}
    >
      <Icon className="size-5 shrink-0" />
      <span>
        <span className="block text-[14px] font-semibold">{label}</span>
        <span className={cn("block text-xs", primary ? "text-primary-foreground/75" : "text-muted-foreground")}>{hint}</span>
      </span>
    </button>
  );
}

function PhotoMetaInput({ label, placeholder, defaultValue, onCommit, disabled }: { label: string; placeholder: string; defaultValue: string; onCommit: (value: string) => void; disabled?: boolean }) {
  const [value, setValue] = useState(defaultValue);
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      <Input value={value} placeholder={placeholder} disabled={disabled} onChange={(e) => setValue(e.target.value)} onBlur={() => onCommit(value.trim())} className="h-10 rounded-lg text-[14px]" />
    </label>
  );
}
