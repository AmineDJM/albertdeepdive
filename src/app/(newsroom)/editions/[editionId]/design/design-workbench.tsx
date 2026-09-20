"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Eye, History, Lock, LockOpen, Mail, Monitor, Send, Sparkles, Trophy, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useUi } from "@/components/i18n/provider";
import type { DesignState } from "@/server/design/console";
import {
  designDialAction,
  designEditionAction,
  designLayoutAction,
  designOperationAction,
  designRefineAction,
  designRestoreAction,
  designSayAction,
  designTournamentAction,
  type LayoutReport,
} from "./actions";

/**
 * The issue, and the controls that change it.
 *
 * The preview is live and on the left, because a control whose effect you have to export a PDF to
 * see is not a control. On the right, in the order §28 asks for: what the issue should feel like,
 * then the piece you have selected, then the conversation, then what has been done to it.
 *
 * Selecting a block is the thing that makes the rest work — the alternatives are that block's, the
 * lock is that block's, and "not like that" in the chat is about that block. Nothing else on this
 * screen needs explaining once that is understood.
 */

const DIALS = ["density", "colourIntensity", "ornament", "variation"] as const;

export function DesignWorkbench({ editionId, initial }: { editionId: string; initial: DesignState }) {
  const tr = useUi();
  const router = useRouter();
  const [state, setState] = useState<DesignState>(initial);
  const [medium, setMedium] = useState<"web" | "email">("web");
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [layout, setLayout] = useState<LayoutReport | null>(null);
  const [dials, setDials] = useState(initial.dials);
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [proofKey, setProofKey] = useState(0);
  const threadEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    threadEnd.current?.scrollIntoView({ block: "end" });
  }, [state.turns.length]);

  const settle = useCallback(
    (next: DesignState) => {
      setState(next);
      setDials(next.dials);
      setProofKey((key) => key + 1);
      startTransition(() => router.refresh());
    },
    [router],
  );

  async function run<T>(what: string, action: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>, then: (data: T) => void) {
    setBusy(what);
    try {
      const result = await action();
      if (result.ok) then(result.data);
      else toast.error(result.error);
    } finally {
      setBusy(null);
    }
  }

  const block = state.blocks.find((candidate) => candidate.id === selected) ?? null;
  const designed = Boolean(state.design);

  /*
   * Written as literal calls on purpose.
   *
   * The dictionary is built by reading `tr("…")` out of the source, so a label assembled from a
   * variable is a label that never reaches French. These two maps are the price of that, and it is
   * a price worth paying for an interface that is genuinely bilingual rather than nearly.
   */
  const dialLabel: Record<(typeof DIALS)[number], string> = {
    density: tr("Density"),
    colourIntensity: tr("Colour"),
    ornament: tr("Ornament"),
    variation: tr("Variation"),
  };
  const dialHint: Record<(typeof DIALS)[number], string> = {
    density: tr("Airy, or full."),
    colourIntensity: tr("How much colour the pages carry."),
    ornament: tr("Rules, marks and figures."),
    variation: tr("How much one page may differ from the last."),
  };
  const roleLabel: Record<string, string> = {
    cover: tr("The cover"),
    masthead: tr("The masthead"),
    lead: tr("The lead"),
    feature: tr("A feature"),
    secondary: tr("A story"),
    brief: tr("A brief"),
    "brief-group": tr("The briefs"),
    quote: tr("A quote"),
    "pull-quote": tr("A pulled quote"),
    "section-opener": tr("A section opener"),
    "photo-spread": tr("The pictures"),
    "stat-group": tr("The figures"),
    footer: tr("The footer"),
    credits: tr("The credits"),
    events: tr("What is coming"),
  };
  const nameOf = (role: string) => roleLabel[role] ?? role.replace(/-/g, " ");

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
      {/* ── The issue ─────────────────────────────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 py-2">
          <div className="flex items-center gap-1">
            <Button size="sm" variant={medium === "web" ? "secondary" : "ghost"} onClick={() => setMedium("web")}>
              <Monitor className="mr-1.5 size-3.5" /> {tr("Web")}
            </Button>
            <Button size="sm" variant={medium === "email" ? "secondary" : "ghost"} onClick={() => setMedium("email")}>
              <Mail className="mr-1.5 size-3.5" /> {tr("Email")}
            </Button>
          </div>
          <Button size="sm" variant="outline" disabled={!designed || busy !== null} onClick={() => run("layout", () => designLayoutAction(editionId), setLayout)}>
            <Eye className="mr-1.5 size-3.5" /> {busy === "layout" ? tr("Laying out…") : tr("Lay out the pages")}
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {layout ? (
            <p className="border-b border-border bg-muted/40 px-4 py-2 text-2xs text-muted-foreground">
              {layout.summary}
              {layout.overflowing.length ? ` · ${tr("{count} pages still spill", { count: layout.overflowing.length })}` : ` · ${tr("nothing spills")}`}
              {layout.underfilled.length ? ` · ${tr("{count} more than a quarter empty", { count: layout.underfilled.length })}` : ""}
            </p>
          ) : null}
          <iframe
            key={`${medium}-${proofKey}`}
            title={tr("The design")}
            src={`/design/edition/${editionId}?medium=${medium}`}
            className={cn("w-full border-0 bg-white", medium === "email" ? "h-[70vh]" : "h-[70vh]")}
          />
        </CardContent>
      </Card>

      {/* ── The controls ──────────────────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">{tr("How this issue should feel")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-2xs text-muted-foreground">{state.intent}</p>
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="outline">{state.dials.mood}</Badge>
              <Badge variant="outline">{state.dials.typographicVoice}</Badge>
              <Badge variant="outline">{tr("photography: {usage}", { usage: state.dials.imageUsage })}</Badge>
              <Badge variant="outline">{state.grid}</Badge>
            </div>
            <Separator />
            {DIALS.map((dial) => (
              <div key={dial}>
                <div className="flex items-baseline justify-between">
                  <Label htmlFor={`dial-${dial}`}>{dialLabel[dial]}</Label>
                  <span className="tabular text-2xs text-muted-foreground">{Math.round(dials[dial] * 100)}%</span>
                </div>
                <input
                  id={`dial-${dial}`}
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={dials[dial]}
                  disabled={!designed || busy !== null}
                  onChange={(event) => setDials((current) => ({ ...current, [dial]: Number(event.target.value) }))}
                  onMouseUp={(event) => run(`dial-${dial}`, () => designDialAction(editionId, dial, Number((event.target as HTMLInputElement).value)), settle)}
                  onTouchEnd={(event) => run(`dial-${dial}`, () => designDialAction(editionId, dial, Number((event.target as HTMLInputElement).value)), settle)}
                  className="mt-1.5 w-full accent-[var(--brand)] disabled:cursor-not-allowed"
                />
                <p className="mt-0.5 text-2xs text-muted-foreground">{dialHint[dial]}</p>
              </div>
            ))}
            <Separator />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={busy !== null} onClick={() => run("design", () => designEditionAction(editionId), settle)}>
                <Wand2 className="mr-1.5 size-3.5" /> {busy === "design" ? tr("Designing…") : designed ? tr("Design it again") : tr("Design this issue")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!designed || busy !== null}
                onClick={() =>
                  run("refine", () => designRefineAction(editionId), (data) => {
                    settle(data.state);
                    toast.success(data.said);
                  })
                }
              >
                <Sparkles className="mr-1.5 size-3.5" /> {busy === "refine" ? tr("Looking…") : tr("Look and fix")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!designed || busy !== null}
                onClick={() =>
                  run("tournament", () => designTournamentAction(editionId), (data) => {
                    settle(data.state);
                    toast.success(data.result.because);
                  })
                }
              >
                <Trophy className="mr-1.5 size-3.5" /> {busy === "tournament" ? tr("Drawing covers…") : tr("Try three covers")}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="pieces">
          <TabsList className="w-full">
            <TabsTrigger value="pieces" className="flex-1">
              {tr("Pieces")}
            </TabsTrigger>
            <TabsTrigger value="talk" className="flex-1">
              {tr("Ask")}
            </TabsTrigger>
            <TabsTrigger value="notes" className="flex-1">
              {tr("Notes")}
              {state.findings.length ? <span className="ml-1 text-2xs text-muted-foreground">{state.findings.length}</span> : null}
            </TabsTrigger>
            <TabsTrigger value="history" className="flex-1">
              <History className="size-3.5" />
            </TabsTrigger>
          </TabsList>

          {/* ── The piece you have selected ─────────────────────────────────────────── */}
          <TabsContent value="pieces" className="mt-3 space-y-3">
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border p-1">
              {state.blocks.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setSelected(entry.id === selected ? null : entry.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors",
                    entry.id === selected ? "bg-secondary" : "hover:bg-muted/60",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{entry.headline ?? nameOf(entry.role)}</span>
                  <span className="shrink-0 text-2xs text-muted-foreground">{entry.composition.replace(/-/g, " ")}</span>
                  {entry.locked || entry.lockedAspects.length ? <Lock className="size-3 shrink-0 text-muted-foreground" /> : null}
                </button>
              ))}
              {!state.blocks.length ? <p className="p-3 text-2xs text-muted-foreground">{tr("Nothing has been designed yet.")}</p> : null}
            </div>

            {block ? (
              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-sm">{block.headline ?? nameOf(block.role)}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {block.rationale ? <p className="text-2xs text-muted-foreground">{block.rationale}</p> : null}
                  <div>
                    <Label>{tr("Draw it another way")}</Label>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {block.alternatives.length ? (
                        block.alternatives.map((composition) => (
                          <Button
                            key={composition}
                            size="sm"
                            variant="outline"
                            disabled={busy !== null || block.locked}
                            onClick={() => run(`composition-${composition}`, () => designOperationAction(editionId, { kind: "set_composition", blockId: block.id, composition }), settle)}
                          >
                            {composition.replace(/-/g, " ")}
                          </Button>
                        ))
                      ) : (
                        <p className="text-2xs text-muted-foreground">{tr("There is no other way this piece can be drawn with the material it has.")}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy !== null}
                      onClick={() =>
                        run(
                          "lock",
                          () =>
                            designOperationAction(editionId, block.locked || block.lockedAspects.length ? { kind: "unlock", blockId: block.id } : { kind: "lock", blockId: block.id, aspects: [] }),
                          settle,
                        )
                      }
                    >
                      {block.locked || block.lockedAspects.length ? <LockOpen className="mr-1.5 size-3.5" /> : <Lock className="mr-1.5 size-3.5" />}
                      {block.locked || block.lockedAspects.length ? tr("Release it") : tr("Hold it as it is")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy !== null || block.locked}
                      onClick={() => run("redesign", () => designOperationAction(editionId, { kind: "redesign", scope: "block", targetId: block.id, steer: null }), settle)}
                    >
                      <Wand2 className="mr-1.5 size-3.5" /> {tr("Design this again")}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <p className="px-1 text-2xs text-muted-foreground">{tr("Choose a piece to change how it is drawn, or to hold it against the next redesign.")}</p>
            )}
          </TabsContent>

          {/* ── The conversation ────────────────────────────────────────────────────── */}
          <TabsContent value="talk" className="mt-3 space-y-2">
            <div className="max-h-72 space-y-2 overflow-y-auto rounded-md border border-border p-2">
              {state.turns.map((turn) => (
                <div key={turn.id} className={cn("rounded px-2 py-1.5 text-xs", turn.role === "user" ? "bg-secondary" : "bg-muted/50")}>
                  <p className="whitespace-pre-wrap">{turn.content}</p>
                  {turn.outcomes.length ? (
                    <ul className="mt-1 space-y-0.5">
                      {turn.outcomes.map((outcome, index) => (
                        <li key={index} className={cn("text-2xs", outcome.done ? "text-muted-foreground" : "text-amber-600 dark:text-amber-500")}>
                          {outcome.what}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ))}
              {!state.turns.length ? <p className="p-3 text-2xs text-muted-foreground">{tr("Say what you would like changed. “Hold the cover.” “The photographs are too small.”")}</p> : null}
              <div ref={threadEnd} />
            </div>
            {block ? <p className="px-1 text-2xs text-muted-foreground">{tr("Talking about: {piece}", { piece: block.headline ?? nameOf(block.role) })}</p> : null}
            <Textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={2}
              placeholder={tr("Ask for a change in your own words")}
              disabled={busy !== null}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  if (message.trim()) {
                    const said = message.trim();
                    setMessage("");
                    run("say", () => designSayAction(editionId, said, selected ? [selected] : []), (reply) => settle({ ...state, turns: reply.turns, design: reply.design, revision: reply.revision }));
                  }
                }
              }}
            />
            <Button
              size="sm"
              className="w-full"
              disabled={busy !== null || !message.trim()}
              onClick={() => {
                const said = message.trim();
                setMessage("");
                run("say", () => designSayAction(editionId, said, selected ? [selected] : []), (reply) => settle({ ...state, turns: reply.turns, design: reply.design, revision: reply.revision }));
              }}
            >
              <Send className="mr-1.5 size-3.5" /> {busy === "say" ? tr("Thinking…") : tr("Send")}
            </Button>
          </TabsContent>

          {/* ── What the critic found ───────────────────────────────────────────────── */}
          <TabsContent value="notes" className="mt-3">
            <p className="mb-2 px-1 text-2xs text-muted-foreground">{state.verdict}</p>
            <div className="space-y-1.5">
              {state.findings.map((finding) => (
                <button
                  key={finding.id}
                  type="button"
                  onClick={() => finding.blockId && setSelected(finding.blockId)}
                  className="flex w-full items-start gap-2 rounded border border-border px-2 py-1.5 text-left text-2xs hover:bg-muted/60"
                >
                  <Badge variant={finding.severity === "BLOCKING" ? "destructive" : finding.severity === "SERIOUS" ? "outline" : "secondary"} className="shrink-0">
                    {finding.dimension}
                  </Badge>
                  <span className="min-w-0 flex-1">{finding.issue}</span>
                </button>
              ))}
              {!state.findings.length ? <p className="px-1 text-2xs text-muted-foreground">{tr("Nothing to fix.")}</p> : null}
            </div>
          </TabsContent>

          {/* ── What has been done to it ────────────────────────────────────────────── */}
          <TabsContent value="history" className="mt-3 space-y-1.5">
            {state.history.map((entry) => (
              <div key={entry.revision} className="flex items-center gap-2 rounded border border-border px-2 py-1.5 text-2xs">
                <span className="tabular shrink-0 text-muted-foreground">#{entry.revision}</span>
                <span className="min-w-0 flex-1 truncate">{entry.summary ?? tr("Designed")}</span>
                {entry.isCurrent ? (
                  <Badge variant="secondary" className="shrink-0">
                    {tr("now")}
                  </Badge>
                ) : (
                  <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => run("restore", () => designRestoreAction(editionId, entry.revision), settle)}>
                    {tr("Put it back")}
                  </Button>
                )}
              </div>
            ))}
            {!state.history.length ? <p className="px-1 text-2xs text-muted-foreground">{tr("Nothing yet.")}</p> : null}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
