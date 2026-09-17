import { ImageResponse } from "next/og";
import { BRAND } from "@/lib/brand";
import { GRADIENT, HEX } from "@/lib/brand/palette";

export const runtime = "nodejs";
export const alt = `${BRAND.name} — ${BRAND.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * The card people see when Briefly is shared.
 *
 * Drawn rather than designed in a file, so it never drifts from the brand tokens and needs no asset
 * pipeline. A share card competes with a headline in somebody's feed, so it wins on clarity: the
 * mark, the name, one sentence, and the spectrum as a single band along the bottom — enough colour
 * to be recognisable at thumbnail size without anything to read.
 *
 * `ImageResponse` renders a Satori subset: flex only, no `gap` shorthand surprises, and every colour
 * as a value it can parse today, which is why this reads hex rather than the OKLCH the app uses.
 */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: BRAND.ink,
          color: BRAND.paper,
          padding: 80,
          paddingBottom: 64,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          <svg width="72" height="72" viewBox="0 0 100 100">
            <defs>
              <linearGradient id="og" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor={GRADIENT[0]} />
                <stop offset="52%" stopColor={GRADIENT[1]} />
                <stop offset="100%" stopColor={GRADIENT[2]} />
              </linearGradient>
            </defs>
            <rect width="100" height="100" rx="24" fill="url(#og)" />
            <g transform="translate(13.9 13.9) scale(0.722)">
              <path
                fillRule="evenodd"
                fill={BRAND.paper}
                d="M23 14 h31 a18 18 0 0 1 0 36 h-36 v-31 a5 5 0 0 1 5-5 z M18 50 h46 a18 18 0 0 1 0 36 h-41 a5 5 0 0 1-5-5 z M40 25 h14 a7 7 0 0 1 0 14 h-14 a7 7 0 0 1 0-14 z M40 61 h24 a7 7 0 0 1 0 14 h-24 a7 7 0 0 1 0-14 z"
              />
            </g>
          </svg>
          <div style={{ fontSize: 42, fontWeight: 600, letterSpacing: -1.5 }}>{BRAND.name}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 86, fontWeight: 600, letterSpacing: -3.5, lineHeight: 1.02 }}>Your organization,</div>
          <div style={{ fontSize: 86, fontWeight: 600, letterSpacing: -3.5, lineHeight: 1.02, opacity: 0.5 }}>published.</div>
          <div style={{ fontSize: 28, lineHeight: 1.45, marginTop: 28, opacity: 0.6, maxWidth: 880 }}>
            Email, web, magazine and print — from the same edition.
          </div>
        </div>

        <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", marginTop: 44 }}>
          {(["cobalt", "violet", "magenta", "coral", "amber", "green", "teal"] as const).map((hue) => (
            <div key={hue} style={{ flex: 1, background: HEX[hue] }} />
          ))}
        </div>
      </div>
    ),
    size,
  );
}
