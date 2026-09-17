"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Globe, Mail, Pencil, Plus, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { createPublicationAction, updatePublicationAction, type PublicationInput } from "./actions";
import { cn } from "@/lib/utils";

type Publication = {
  id: string;
  name: string;
  description: string | null;
  language: string;
  cadence: string;
  defaultFormats: string[];
  isPublic: boolean;
  status: string;
};

const FORMATS = [
  { value: "EMAIL", label: "Email", icon: Mail },
  { value: "WEB", label: "Web", icon: Globe },
  { value: "MAGAZINE", label: "Magazine", icon: BookOpen },
  { value: "PRINT", label: "Print", icon: Printer },
] as const;

/**
 * A recurring title.
 *
 * The formats chosen here are the ones a *new* edition starts with, not a constraint on it: a
 * monthly email can still be printed once a year without changing the title.
 */
export function PublicationEditor({ publication, trigger }: { publication?: Publication; trigger?: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(publication?.name ?? "");
  const [description, setDescription] = useState(publication?.description ?? "");
  const [language, setLanguage] = useState(publication?.language ?? "en");
  const [cadence, setCadence] = useState(publication?.cadence ?? "monthly");
  const [formats, setFormats] = useState<string[]>(publication?.defaultFormats?.length ? publication.defaultFormats : ["EMAIL"]);
  const [isPublic, setIsPublic] = useState(publication?.isPublic ?? true);
  const [status, setStatus] = useState(publication?.status ?? "ACTIVE");

  function toggleFormat(value: string) {
    setFormats((current) => (current.includes(value) ? current.filter((f) => f !== value) : [...current, value]));
  }

  function submit() {
    if (!formats.length) {
      toast.error("Choose at least one format");
      return;
    }
    startTransition(async () => {
      const payload = {
        name,
        description: description || null,
        language: language as PublicationInput["language"],
        cadence: cadence as PublicationInput["cadence"],
        defaultFormats: formats as PublicationInput["defaultFormats"],
        isPublic,
        status: status as PublicationInput["status"],
      };
      const result = publication ? await updatePublicationAction(publication.id, payload) : await createPublicationAction(payload);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(publication ? "Title updated" : "Title created");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          publication ? (
            <Button variant="ghost" size="icon-sm" aria-label={`Edit ${publication.name}`}>
              <Pencil />
            </Button>
          ) : (
            <Button size="sm">
              <Plus /> New title
            </Button>
          )
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{publication ? "Edit title" : "New title"}</DialogTitle>
          <DialogDescription>A recurring publication. Each of its editions decides for itself where it is published.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="pub-name">Name</Label>
            <Input id="pub-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Weekly" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pub-description">Description</Label>
            <Textarea id="pub-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="What this title covers, and for whom." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pub-cadence">Cadence</Label>
              <NativeSelect id="pub-cadence" value={cadence} onChange={(e) => setCadence(e.target.value)}>
                <option value="weekly">Weekly</option>
                <option value="fortnightly">Fortnightly</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="irregular">Irregular</option>
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pub-language">Language</Label>
              <NativeSelect id="pub-language" value={language} onChange={(e) => setLanguage(e.target.value)}>
                <option value="en">English</option>
                <option value="fr">Français</option>
              </NativeSelect>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Usual formats</Label>
            <div className="grid grid-cols-2 gap-2">
              {FORMATS.map(({ value, label, icon: Icon }) => {
                const on = formats.includes(value);
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => toggleFormat(value)}
                    aria-pressed={on}
                    className={cn(
                      "flex items-center gap-2 rounded-md border px-3 py-2 text-[13px] transition-colors",
                      on ? "border-foreground/25 bg-card font-medium shadow-xs" : "border-dashed border-border text-muted-foreground hover:bg-muted/40",
                    )}
                  >
                    <Icon className="size-3.5" /> {label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">What a new edition starts with. Any edition can add or drop a format.</p>
          </div>
          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <div>
              <Label htmlFor="pub-public">Open to subscribers</Label>
              <p className="text-xs text-muted-foreground">Anyone with the link can subscribe.</p>
            </div>
            <Switch id="pub-public" checked={isPublic} onCheckedChange={setIsPublic} />
          </div>
          {publication ? (
            <div className="space-y-1.5">
              <Label htmlFor="pub-status">Status</Label>
              <NativeSelect id="pub-status" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="DRAFT">Draft</option>
                <option value="ACTIVE">Active</option>
                <option value="PAUSED">Paused</option>
                <option value="ARCHIVED">Archived</option>
              </NativeSelect>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} loading={pending} disabled={!name.trim()}>
            {publication ? "Save" : "Create title"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
