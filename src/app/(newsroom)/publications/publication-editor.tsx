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
import { CURRENCY_SYMBOLS, PRICE_CURRENCIES, PRICE_INTERVALS, parseAmountToCents, type PriceCurrency, type PriceInterval } from "@/lib/payments";
import { useUi } from "@/components/i18n/provider";

type Publication = {
  id: string;
  name: string;
  description: string | null;
  language: string;
  cadence: string;
  defaultFormats: string[];
  isPublic: boolean;
  status: string;
  access?: string;
  priceCents?: number | null;
  priceCurrency?: string;
  priceInterval?: string;
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
export function PublicationEditor({ publication, trigger, paymentsConnected = false }: { publication?: Publication; trigger?: React.ReactNode; paymentsConnected?: boolean }) {
  const tr = useUi();
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
  const [access, setAccess] = useState<"free" | "paid">(publication?.access === "paid" ? "paid" : "free");
  const [amount, setAmount] = useState(publication?.priceCents ? (publication.priceCents / 100).toFixed(2).replace(/\.00$/, "") : "");
  const [currency, setCurrency] = useState<PriceCurrency>((publication?.priceCurrency as PriceCurrency) ?? "eur");
  const [interval, setInterval] = useState<PriceInterval>((publication?.priceInterval as PriceInterval) ?? "month");

  function toggleFormat(value: string) {
    setFormats((current) => (current.includes(value) ? current.filter((f) => f !== value) : [...current, value]));
  }

  function submit() {
    if (!formats.length) {
      toast.error(tr("Choose at least one format"));
      return;
    }
    const priceCents = access === "paid" ? parseAmountToCents(amount) : null;
    if (access === "paid" && !priceCents) {
      toast.error(tr("Enter what a subscription costs, like 5 or 4.50"));
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
        access,
        priceCents,
        priceCurrency: currency,
        priceInterval: interval,
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
              <Plus /> {" "}{tr("New title")}</Button>
          )
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{publication ? "Edit title" : "New title"}</DialogTitle>
          <DialogDescription>{tr("A recurring publication. Each of its editions decides for itself where it is published.")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="pub-name">{tr("Name")}</Label>
            <Input id="pub-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={tr("Acme Weekly")} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pub-description">{tr("Description")}</Label>
            <Textarea id="pub-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder={tr("What this title covers, and for whom.")} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pub-cadence">{tr("Cadence")}</Label>
              <NativeSelect id="pub-cadence" value={cadence} onChange={(e) => setCadence(e.target.value)}>
                <option value="weekly">{tr("Weekly")}</option>
                <option value="fortnightly">{tr("Fortnightly")}</option>
                <option value="monthly">{tr("Monthly")}</option>
                <option value="quarterly">{tr("Quarterly")}</option>
                <option value="irregular">{tr("Irregular")}</option>
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pub-language">{tr("Language")}</Label>
              <NativeSelect id="pub-language" value={language} onChange={(e) => setLanguage(e.target.value)}>
                <option value="en">{tr("English")}</option>
                <option value="fr">{tr("Français")}</option>
              </NativeSelect>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{tr("Usual formats")}</Label>
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
            <p className="text-xs text-muted-foreground">{tr("What a new edition starts with. Any edition can add or drop a format.")}</p>
          </div>
          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <div>
              <Label htmlFor="pub-public">{tr("Open to subscribers")}</Label>
              <p className="text-xs text-muted-foreground">{tr("Anyone with the link can subscribe.")}</p>
            </div>
            <Switch id="pub-public" checked={isPublic} onCheckedChange={setIsPublic} />
          </div>
          {/*
            Free or paid, and the price. Charging needs the workspace's own Stripe account: the money
            goes to the customer, so the option is only live once there is somewhere for it to go.
          */}
          <div className="space-y-2 rounded-md border border-border px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label htmlFor="pub-access">{tr("Access")}</Label>
                <p className="text-xs text-muted-foreground">
                  {paymentsConnected ? "Paid titles are billed through your Stripe account." : "To charge for a title, connect your Stripe account in Settings → Reader payments."}
                </p>
              </div>
              <NativeSelect id="pub-access" value={access} disabled={!paymentsConnected && access === "free"} onChange={(e) => setAccess(e.target.value as "free" | "paid")} className="w-auto">
                <option value="free">{tr("Free")}</option>
                <option value="paid">{tr("Paid")}</option>
              </NativeSelect>
            </div>
            {access === "paid" ? (
              <div className="grid grid-cols-[1fr_auto_auto] gap-2">
                <div className="relative">
                  <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-muted-foreground">{CURRENCY_SYMBOLS[currency]}</span>
                  <Input id="pub-price" aria-label={tr("Price")} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="5" className="pl-8" />
                </div>
                <NativeSelect aria-label={tr("Currency")} value={currency} onChange={(e) => setCurrency(e.target.value as PriceCurrency)} className="w-auto">
                  {PRICE_CURRENCIES.map((code) => (
                    <option key={code} value={code}>
                      {code.toUpperCase()}
                    </option>
                  ))}
                </NativeSelect>
                <NativeSelect aria-label={tr("Billing interval")} value={interval} onChange={(e) => setInterval(e.target.value as PriceInterval)} className="w-auto">
                  {PRICE_INTERVALS.map((value) => (
                    <option key={value} value={value}>
                      {tr("per")}{" "}{value}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            ) : null}
          </div>
          {publication ? (
            <div className="space-y-1.5">
              <Label htmlFor="pub-status">{tr("Status")}</Label>
              <NativeSelect id="pub-status" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="DRAFT">{tr("Draft")}</option>
                <option value="ACTIVE">{tr("Active")}</option>
                <option value="PAUSED">{tr("Paused")}</option>
                <option value="ARCHIVED">{tr("Archived")}</option>
              </NativeSelect>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {tr("Cancel")}</Button>
          <Button onClick={submit} loading={pending} disabled={!name.trim()}>
            {publication ? "Save" : "Create title"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
