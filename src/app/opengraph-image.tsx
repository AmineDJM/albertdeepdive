import { ImageResponse } from "next/og";
import { BRAND } from "@/lib/brand";
import { GOOGLE, GRADIENT } from "@/lib/brand/palette";

export const runtime = "nodejs";
export const alt = `${BRAND.name} — ${BRAND.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * The card people see when Briefly is shared.
 *
 * Drawn rather than designed in a file, so it never drifts from the brand tokens and needs no asset
 * pipeline. A share card competes with a headline in somebody's feed, so it wins on clarity: the
 * mark, the name, one sentence, and Google's four colours as a single band along the bottom — enough colour
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
          background: "#FBFBFD",
          color: GOOGLE.ink,
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
                <stop offset="38%" stopColor={GRADIENT[1]} />
                <stop offset="68%" stopColor={GRADIENT[2]} />
                <stop offset="100%" stopColor={GRADIENT[3]} />
              </linearGradient>
            </defs>
            <rect width="100" height="100" rx="23" fill="url(#og)" />
            <rect x="27.7" y="27.7" width="44.6" height="44.6" rx="12" fill="#FFFFFF" />
          </svg>
          <div style={{ fontSize: 44, fontWeight: 600, letterSpacing: -1.6 }}>{BRAND.name}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 90, fontWeight: 600, letterSpacing: -3.8, lineHeight: 1.02 }}>Your organization,</div>
          <div style={{ fontSize: 90, fontWeight: 600, letterSpacing: -3.8, lineHeight: 1.02, color: "#86868B" }}>published.</div>
          <div style={{ fontSize: 28, lineHeight: 1.45, marginTop: 28, color: "#6E6E73", maxWidth: 880 }}>
            Email, web, magazine and print — from the same edition.
          </div>
        </div>

        <div style={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden", marginTop: 44 }}>
          {([GOOGLE.blue, GOOGLE.red, GOOGLE.yellow, GOOGLE.green] as const).map((colour) => (
            <div key={colour} style={{ flex: 1, background: colour }} />
          ))}
        </div>
      </div>
    ),
    size,
  );
}
