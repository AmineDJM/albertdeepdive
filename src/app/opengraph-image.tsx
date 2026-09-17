import { ImageResponse } from "next/og";
import { BRAND } from "@/lib/brand";

export const runtime = "nodejs";
export const alt = `${BRAND.name} — ${BRAND.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * The card people see when Briefly is shared.
 *
 * Drawn rather than designed in a file, so it never drifts from the brand tokens and needs no asset
 * pipeline. Deliberately plain: a mark, the name, the one sentence — a share card competing with a
 * headline in somebody's feed wins on clarity, not on decoration.
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
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ width: 64, height: 64, borderRadius: 16, background: BRAND.paper, display: "flex", flexDirection: "column", justifyContent: "center", gap: 7, padding: 16 }}>
            <div style={{ width: 20, height: 5, borderRadius: 3, background: BRAND.accent }} />
            <div style={{ width: 32, height: 5, borderRadius: 3, background: BRAND.ink }} />
            <div style={{ width: 26, height: 5, borderRadius: 3, background: BRAND.ink, opacity: 0.55 }} />
          </div>
          <div style={{ fontSize: 40, fontWeight: 600, letterSpacing: -1.5 }}>{BRAND.name}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 86, fontWeight: 600, letterSpacing: -3.5, lineHeight: 1.02 }}>Your organization,</div>
          <div style={{ fontSize: 86, fontWeight: 600, letterSpacing: -3.5, lineHeight: 1.02, opacity: 0.5 }}>published.</div>
          <div style={{ fontSize: 28, lineHeight: 1.45, marginTop: 28, opacity: 0.6, maxWidth: 880 }}>
            Email, web, magazine and print — from the same edition.
          </div>
        </div>
      </div>
    ),
    size,
  );
}
