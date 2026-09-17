"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Check, RefreshCw, Sparkles } from "lucide-react";
import { rediscoverBrandAction, saveBrandAction } from "./actions";
import { compileBrandSystem, contrastReport, IMAGERY_TREATMENTS, MOTION_PACES, TONE_WORDS, type BrandSystem, type BrandTokens } from "@/lib/brand/system";
import { PERSONALITIES, PERSONALITY_KEYS, type PersonalityKey } from "@/lib/brand/typography";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { SectionTitle } from "@/components/newsroom/page-header";
import { cn } from "@/lib/utils";

type Origin = Record<string, "discovered" | "default" | undefined>;

/**
 * The brand editor.
 *
 * Five decisions and a preview. Everything else a design system needs — contrast-safe text colours,
 * a type scale, radii, motion timings — is derived, so there is nothing here to get subtly wrong.
 *
 * The preview compiles with the same function the renderers use, in the browser, on every keystroke.
 * That is the point: you are not looking at an impression of your brand, you are looking at the
 * exact tokens your next magazine will be set in, including the moment a colour you like stops being
 * readable and gets corrected in front of you.
 */
export function BrandEditor({
  canEdit,
  organizationName,
  initial,
  initialTokens,
  origin,
  notes,
  website,
}: {
  canEdit: boolean;
  organizationName: string;
  initial: BrandSystem;
  initialTokens: BrandTokens;
  origin: Origin;
  notes: string[];
  website: string;
}) {
  const router = useRouter();
  const [system, setSystem] = useState<BrandSystem>(initial);
  const [saving, startSaving] = useTransition();
  const [discovering, startDiscovering] = useTransition();
  const [proposalNotes, setProposalNotes] = useState<string[]>(notes);

  // Compiling is pure, cheap and identical on both sides, so the preview is synchronous and is
  // literally the tokens the server would produce — not a second implementation that can drift.
  const tokens = useMemo(() => {
    try {
      return compileBrandSystem(system);
    } catch {
      return initialTokens;
    }
  }, [system, initialTokens]);
  const contrast = useMemo(() => contrastReport(tokens), [tokens]);
  const failures = contrast.filter((row) => !row.passes);
  const dirty = JSON.stringify(system) !== JSON.stringify(initial);

  const set = <K extends keyof BrandSystem>(key: K, value: BrandSystem[K]) => setSystem((s) => ({ ...s, [key]: value }));
  const setColour = (key: keyof BrandSystem["colours"], value: string) => setSystem((s) => ({ ...s, colours: { ...s.colours, [key]: value } }));

  function save() {
    startSaving(async () => {
      const result = await saveBrandAction(system);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Brand saved");
      router.refresh();
    });
  }

  function rediscover() {
    startDiscovering(async () => {
      const result = await rediscoverBrandAction();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setSystem(result.data.system);
      setProposalNotes(result.data.notes);
      toast.success("Read from your website — nothing is saved until you say so");
    });
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      <div className="space-y-6">
        {proposalNotes.length ? (
          <ul className="space-y-1.5 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            {proposalNotes.map((note) => (
              <li key={note} className="flex gap-2">
                <Sparkles className="mt-0.5 size-3 shrink-0" aria-hidden />
                {note}
              </li>
            ))}
          </ul>
        ) : null}

        <section>
          <SectionTitle
            action={
              canEdit && website ? (
                <Button variant="ghost" size="xs" onClick={rediscover} disabled={discovering}>
                  <RefreshCw className={cn("size-3", discovering && "animate-spin")} /> Read my site again
                </Button>
              ) : null
            }
          >
            Colours
          </SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ["brand", "Brand", "The colour someone would name if asked what colour you are."],
                ["accent", "Accent", "Used sparingly, for the one thing on a page that should be noticed."],
                ["ink", "Ink", "Text, at its darkest."],
                ["paper", "Paper", "What everything is set on."],
              ] as const
            ).map(([key, label, hint]) => (
              <div key={key}>
                <Label htmlFor={`brand-${key}`} className="flex items-center gap-1.5">
                  {label}
                  {origin[key] === "discovered" ? <Badge variant="muted" className="font-normal">from your site</Badge> : null}
                </Label>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="color"
                    aria-label={`${label} colour`}
                    value={system.colours[key]}
                    disabled={!canEdit}
                    onChange={(e) => setColour(key, e.target.value.toUpperCase())}
                    className="size-8 shrink-0 cursor-pointer rounded-md border border-border bg-transparent p-0.5 disabled:cursor-not-allowed"
                  />
                  <Input id={`brand-${key}`} value={system.colours[key]} disabled={!canEdit} onChange={(e) => setColour(key, e.target.value.toUpperCase())} className="font-mono text-xs uppercase" />
                </div>
                <p className="mt-1 text-2xs text-muted-foreground">{hint}</p>
              </div>
            ))}
          </div>
        </section>

        <section>
          <SectionTitle>Personality</SectionTitle>
          <div className="space-y-1.5">
            {PERSONALITY_KEYS.map((key) => {
              const personality = PERSONALITIES[key];
              const active = system.personality === key;
              return (
                <button
                  key={key}
                  type="button"
                  disabled={!canEdit}
                  onClick={() => set("personality", key as PersonalityKey)}
                  aria-pressed={active}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed",
                    active ? "border-brand bg-brand-soft/40" : "border-border hover:bg-muted/50",
                  )}
                >
                  <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-border bg-background">
                    {active ? <span className="size-2 rounded-full bg-brand" /> : null}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium">{personality.name}</span>
                    <span className="block text-xs text-muted-foreground">{personality.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section>
          <SectionTitle>Shape and imagery</SectionTitle>
          <div className="space-y-4">
            <Slider label="Roundness" hint="Square reads institutional; round reads friendly." value={system.shape.roundness} min={0} max={1} step={0.05} disabled={!canEdit} onChange={(v) => set("shape", { ...system.shape, roundness: v })} />
            <Slider label="Grain" hint="A little noise is what stops a render looking synthetic." value={system.imagery.grain} min={0} max={1} step={0.02} disabled={!canEdit} onChange={(v) => set("imagery", { ...system.imagery, grain: v })} />
            <div>
              <Label>Photographs</Label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {IMAGERY_TREATMENTS.map((treatment) => (
                  <Chip key={treatment} active={system.imagery.treatment === treatment} disabled={!canEdit} onClick={() => set("imagery", { ...system.imagery, treatment })}>
                    {treatment}
                  </Chip>
                ))}
              </div>
            </div>
            <div>
              <Label>Motion</Label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {MOTION_PACES.map((pace) => (
                  <Chip key={pace} active={system.motion.pace === pace} disabled={!canEdit} onClick={() => set("motion", { pace })}>
                    {pace}
                  </Chip>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section>
          <SectionTitle>Voice</SectionTitle>
          <div className="space-y-3">
            <div>
              <Label>Tone</Label>
              <p className="mb-1.5 text-2xs text-muted-foreground">Up to three. Applied to everything written for you.</p>
              <div className="flex flex-wrap gap-1.5">
                {TONE_WORDS.map((word) => {
                  const active = system.voice.tone.includes(word);
                  return (
                    <Chip
                      key={word}
                      active={active}
                      disabled={!canEdit || (!active && system.voice.tone.length >= 3)}
                      onClick={() => set("voice", { ...system.voice, tone: active ? system.voice.tone.filter((t) => t !== word) : [...system.voice.tone, word] })}
                    >
                      {word}
                    </Chip>
                  );
                })}
              </div>
            </div>
            <div>
              <Label htmlFor="brand-person">You are</Label>
              <div className="mt-1.5 flex gap-1.5">
                <Chip active={system.voice.person === "first"} disabled={!canEdit} onClick={() => set("voice", { ...system.voice, person: "first" })}>
                  “we”
                </Chip>
                <Chip active={system.voice.person === "third"} disabled={!canEdit} onClick={() => set("voice", { ...system.voice, person: "third" })}>
                  “{organizationName}”
                </Chip>
              </div>
            </div>
            <div>
              <Label htmlFor="brand-avoid">Words you never use</Label>
              <Input
                id="brand-avoid"
                placeholder="synergy, disruptive, best-in-class"
                disabled={!canEdit}
                value={system.voice.avoid.join(", ")}
                onChange={(e) => set("voice", { ...system.voice, avoid: e.target.value.split(",").map((w) => w.trim()).filter(Boolean).slice(0, 24) })}
                className="mt-1"
              />
              <p className="mt-1 text-2xs text-muted-foreground">Enforced on generated copy, not suggested to it.</p>
            </div>
          </div>
        </section>

        {canEdit ? (
          <div className="sticky bottom-0 flex items-center gap-2 border-t border-border bg-background/95 py-3 backdrop-blur">
            <Button onClick={save} disabled={saving || !dirty}>
              {saving ? "Saving…" : "Save brand"}
            </Button>
            {dirty ? (
              <Button variant="ghost" onClick={() => setSystem(initial)} disabled={saving}>
                Discard
              </Button>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Only an owner or admin of this workspace can change the brand.</p>
        )}
      </div>

      <BrandPreview tokens={tokens} contrast={contrast} failures={failures.length} organizationName={organizationName} />
    </div>
  );
}

function Chip({ active, disabled, onClick, children }: { active: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs capitalize transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        active ? "border-brand bg-brand-soft text-brand-foreground" : "border-border text-muted-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

function Slider({ label, hint, value, min, max, step, disabled, onChange }: { label: string; hint: string; value: number; min: number; max: number; step: number; disabled?: boolean; onChange: (value: number) => void }) {
  const id = `slider-${label.toLowerCase()}`;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <Label htmlFor={id}>{label}</Label>
        <span className="tabular text-2xs text-muted-foreground">{Math.round(value * 100)}%</span>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} className="mt-1.5 w-full accent-[var(--brand)] disabled:cursor-not-allowed" />
      <p className="mt-0.5 text-2xs text-muted-foreground">{hint}</p>
    </div>
  );
}

/**
 * What the brand actually looks like, drawn with the compiled tokens.
 *
 * Every surface, at the real type sizes, plus the contrast table. The table is not decoration: it is
 * the promise this system makes — that no renderer can produce unreadable text — shown being kept.
 */
function BrandPreview({ tokens, contrast, failures, organizationName }: { tokens: BrandTokens; contrast: ReturnType<typeof contrastReport>; failures: number; organizationName: string }) {
  const [display, text, label] = [tokens.type.display, tokens.type.text, tokens.type.label];
  const scale = tokens.type.scale;
  const font = (role: typeof display, size: number) => ({
    fontFamily: role.family === "fraunces" ? "var(--font-fraunces)" : role.family === "newsreader" ? "var(--font-newsreader)" : role.family === "plexMono" ? "var(--font-plex-mono)" : "var(--font-inter)",
    fontWeight: role.weight,
    fontSize: size,
    letterSpacing: role.tracking * size,
    lineHeight: role.leading,
    textTransform: role.case === "upper" ? ("uppercase" as const) : ("none" as const),
  });

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {Object.values(tokens.surfaces).map((surface) => (
          <div key={surface.key} className="overflow-hidden rounded-xl border border-border" style={{ backgroundColor: surface.background, borderRadius: tokens.shape.radiusMd }}>
            <div className="p-5" style={{ color: surface.foreground }}>
              <div style={{ ...font(label, 11), color: surface.subdued }}>{surface.key}</div>
              <div className="mt-2" style={font(display, scale[4])}>
                {organizationName}
              </div>
              <p className="mt-2" style={{ ...font(text, scale[1]), color: surface.subdued }}>
                Every edition, email and export is set in these colours.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <span style={{ backgroundColor: surface.highlight, color: surface.background, borderRadius: tokens.shape.radiusSm, padding: "4px 10px", ...font(label, 10) }}>highlight</span>
                <span className="h-px flex-1" style={{ backgroundColor: surface.rule }} />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="label-caps">Readability</h2>
          {failures ? (
            <span className="flex items-center gap-1.5 text-xs text-amber-600">
              <AlertTriangle className="size-3.5" /> {failures} pair{failures === 1 ? "" : "s"} below target
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs text-emerald-600">
              <Check className="size-3.5" /> Every pair passes
            </span>
          )}
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          Text colours are corrected against the surface they sit on before anything is rendered, so your colours can be whatever they are and still be read.
        </p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
          {contrast.map((row) => (
            <div key={`${row.surface}-${row.role}`} className="flex items-baseline justify-between gap-2 text-2xs">
              <span className="truncate text-muted-foreground">
                {row.surface} · {row.role}
              </span>
              <span className={cn("tabular font-medium", row.passes ? "text-emerald-600" : "text-amber-600")}>{row.ratio.toFixed(1)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <h2 className="label-caps mb-3">Type</h2>
        <div className="space-y-2" style={{ color: "var(--foreground)" }}>
          <div style={font(display, scale[5])}>A headline, set the way yours will be</div>
          <div style={font(display, scale[3])}>A second-level heading</div>
          <p style={font(text, scale[1])}>
            Body text, at reading size. The scale has seven steps and a layout only ever picks one of them — the difference between type that is set and type that has been fitted is whether anybody was allowed to choose 41 pixels.
          </p>
          <div className="pt-1" style={{ ...font(label, 11), color: "var(--muted-foreground)" }}>
            {tokens.type.personality} · {scale.map((n) => Math.round(n)).join(" / ")}
          </div>
        </div>
      </div>
    </div>
  );
}
