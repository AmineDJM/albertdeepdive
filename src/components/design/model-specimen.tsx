"use client";

import { FAMILIES, PERSONALITIES, type PersonalityKey } from "@/lib/brand/typography";
import type { Specimen } from "@/lib/design/models";
import { useUi } from "@/components/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * One model, drawn as a page.
 *
 * Every number comes from `specimenFor`, every font from the model's own personality and every
 * colour from the workspace's brand, so what a person sees here is what the engine would set — not
 * a picture of a newsletter somebody drew once and checked into the repository.
 *
 * The words are sample words and the card says so underneath. They are here because a page of grey
 * boxes tells you nothing about a typeface: you cannot see that a headline is too tight or that the
 * body reads well until there are real sentences in it. They are deliberately about nothing —
 * neutral sentences that could belong to any publication — so that nobody mistakes them for their
 * own newsletter, and they never describe anything that could be read as a fact about the business.
 *
 * The title, by contrast, is real: it is the name of the publication this model would be adopted
 * for, because seeing your own masthead set in a face is most of the decision.
 */
export function ModelSpecimen({
  specimen,
  personality,
  colours,
  title,
  className,
}: {
  specimen: Specimen;
  personality: PersonalityKey;
  colours: { brand: string; accent: string; ink: string; paper: string };
  title: string;
  className?: string;
}) {
  const tr = useUi();
  const p = PERSONALITIES[personality] ?? PERSONALITIES.editorial;
  const display = FAMILIES[p.display.family].stack;
  const text = FAMILIES[p.text.family].stack;
  const label = FAMILIES[p.label.family].stack;

  // The sample is set in its own em space so one card can be rendered at any width and stay in
  // proportion: everything below is a multiple of the card's own body size.
  const base = 7.2;
  const em = (multiple: number) => `${(multiple * base).toFixed(2)}px`;
  const gap = specimen.spacing;

  const reversed = specimen.reversedMasthead;
  const mastheadInk = reversed ? colours.paper : colours.ink;
  const accentInk = specimen.colourFields > 0 ? colours.brand : colours.ink;

  return (
    <div
      className={cn("relative overflow-hidden rounded-md border border-border/80 shadow-xs", className)}
      style={{ background: colours.paper, color: colours.ink, aspectRatio: "3 / 4" }}
      aria-hidden="true"
    >
      <div className="flex h-full flex-col" style={{ padding: em(gap * 1.6) }}>
        {/* The masthead: the one piece of type a reader identifies a publication by. */}
        <div
          style={
            reversed
              ? { background: colours.brand, margin: `${em(-gap * 1.6)} ${em(-gap * 1.6)} 0`, padding: `${em(gap)} ${em(gap * 1.6)}` }
              : undefined
          }
        >
          <div
            style={{
              fontFamily: display,
              fontWeight: p.display.weight,
              fontSize: em(specimen.scale.masthead),
              lineHeight: p.display.leading,
              letterSpacing: `${specimen.tracking.masthead}em`,
              color: mastheadInk,
            }}
          >
            {title}
          </div>
        </div>
        {specimen.rule ? <div style={{ height: 1, background: colours.ink, opacity: 0.35, marginTop: em(gap * 0.7) }} /> : null}

        <div style={{ marginTop: em(gap * 1.2) }}>
          <div
            style={{
              fontFamily: label,
              fontWeight: p.label.weight,
              fontSize: em(specimen.scale.label),
              letterSpacing: `${specimen.tracking.label}em`,
              textTransform: specimen.upperLabel ? "uppercase" : "none",
              color: accentInk,
            }}
          >
            {tr("This month")}
          </div>
          <div
            style={{
              fontFamily: display,
              fontWeight: p.display.weight,
              fontSize: em(specimen.scale.headline),
              lineHeight: specimen.leading.headline,
              letterSpacing: `${specimen.tracking.headline}em`,
              marginTop: em(gap * 0.5),
            }}
          >
            {tr("The quarter in nine paragraphs")}
          </div>
          <div
            style={{
              fontFamily: text,
              fontSize: em(specimen.scale.standfirst),
              lineHeight: 1.35,
              opacity: 0.75,
              marginTop: em(gap * 0.5),
            }}
          >
            {tr("What changed, who did it, and what happens next.")}
          </div>
        </div>

        {specimen.imageShare > 0.02 ? (
          <div
            style={{
              marginTop: em(gap),
              height: `${specimen.imageShare * 100}%`,
              background: `linear-gradient(135deg, ${colours.brand} 0%, ${colours.accent} 100%)`,
              opacity: 0.85,
            }}
          />
        ) : null}

        <div
          style={{
            marginTop: em(gap),
            columnCount: specimen.columns,
            columnGap: em(gap * 1.2),
            fontFamily: text,
            fontWeight: p.text.weight,
            fontSize: em(specimen.scale.body),
            lineHeight: specimen.leading.body,
            flex: 1,
            overflow: "hidden",
          }}
        >
          <p style={{ margin: 0 }}>{tr("A paragraph of sample text, set the way this model sets a paragraph, so the measure and the spacing can be judged rather than imagined.")}</p>
          <p style={{ margin: `${em(gap * 0.6)} 0 0` }}>{tr("A second one, because a single line says nothing about how the type reads at length.")}</p>
        </div>

        {specimen.colourFields > 1 ? (
          <div style={{ marginTop: em(gap * 0.8), display: "flex", gap: em(gap * 0.4) }}>
            {Array.from({ length: Math.min(specimen.colourFields, 3) }, (_, i) => (
              <div key={i} style={{ height: em(gap * 0.8), flex: 1, background: i === 0 ? colours.brand : colours.accent, opacity: 0.8 - i * 0.2 }} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
