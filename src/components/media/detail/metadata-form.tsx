"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { KIND_LABELS, MEDIA_KINDS, type MediaKind } from "@/server/media/constants";
import { updateMetadataAction } from "@/app/(newsroom)/media/[mediaId]/actions";

export type MetadataValue = {
  caption: string;
  altText: string;
  photographer: string;
  credit: string;
  kind: MediaKind;
};

const FIELDS: (keyof MetadataValue)[] = ["caption", "altText", "photographer", "credit", "kind"];

/** Inline editor for the editorial fields of an asset. Remount (key) after a save to reset it. */
export function MetadataForm({
  assetId,
  editionId,
  value,
  canEdit,
}: {
  assetId: string;
  editionId: string | null;
  value: MetadataValue;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState<MetadataValue>(value);
  const [pending, startTransition] = useTransition();
  const dirty = FIELDS.some((k) => form[k] !== value[k]);
  const set = <K extends keyof MetadataValue>(k: K, v: MetadataValue[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  function save() {
    startTransition(async () => {
      const res = await updateMetadataAction(assetId, editionId, {
        caption: form.caption,
        altText: form.altText,
        photographer: form.photographer,
        credit: form.credit,
        kind: form.kind,
      });
      if (!res.ok) {
        toast.error(res.error, {
          description: res.fieldErrors
            ? Object.values(res.fieldErrors).flat().join(" · ")
            : undefined,
        });
        return;
      }
      toast.success(res.message);
      router.refresh();
    });
  }

  if (!canEdit) {
    return (
      <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[13px]">
        <dt className="label-caps self-center">Caption</dt>
        <dd>{value.caption || <span className="text-muted-foreground">—</span>}</dd>
        <dt className="label-caps self-center">Alt text</dt>
        <dd>{value.altText || <span className="text-muted-foreground">—</span>}</dd>
        <dt className="label-caps self-center">Photographer</dt>
        <dd>{value.photographer || <span className="text-muted-foreground">—</span>}</dd>
        <dt className="label-caps self-center">Credit</dt>
        <dd>{value.credit || <span className="text-muted-foreground">—</span>}</dd>
        <dt className="label-caps self-center">Kind</dt>
        <dd>{KIND_LABELS[value.kind]}</dd>
      </dl>
    );
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty) save();
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="media-caption">Caption</Label>
        <Textarea
          id="media-caption"
          rows={2}
          value={form.caption}
          onChange={(e) => set("caption", e.target.value)}
          placeholder="Who / what / where — printed under the photo"
          className="min-h-0"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="media-alt">Alt text</Label>
        <Textarea
          id="media-alt"
          rows={2}
          value={form.altText}
          onChange={(e) => set("altText", e.target.value)}
          placeholder="Describes the image for screen readers and the digital edition"
          className="min-h-0"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="media-photographer">Photographer</Label>
          <Input
            id="media-photographer"
            value={form.photographer}
            onChange={(e) => set("photographer", e.target.value)}
            onBlur={() => {
              if (form.photographer.trim() && !form.credit.trim())
                set("credit", `© ${form.photographer.trim()}`);
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="media-credit">Credit line</Label>
          <Input
            id="media-credit"
            value={form.credit}
            onChange={(e) => set("credit", e.target.value)}
            placeholder="© Name"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="media-kind">Kind</Label>
          <NativeSelect
            id="media-kind"
            value={form.kind}
            onChange={(e) => set("kind", e.target.value as MediaKind)}
          >
            {MEDIA_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex justify-end gap-2">
          {dirty ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setForm(value)}
              disabled={pending}
            >
              Reset
            </Button>
          ) : null}
          <Button type="submit" size="sm" disabled={!dirty} loading={pending}>
            Save
          </Button>
        </div>
      </div>
    </form>
  );
}
