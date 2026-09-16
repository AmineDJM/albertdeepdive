/**
 * The print design system of Albert's Deep Dive as a CSS string (embedded in the print HTML so the
 * renderer never depends on a running web server).
 *
 * Page geometry: A4 by default (variables allow Tabloid/Letter), 14 mm outer margins, a 12-column
 * grid with 4.5 mm gutters, running header at the top and folios at the bottom-outer corner.
 * Type: Fraunces (display), Newsreader (text), Inter (labels), IBM Plex Mono (figures).
 */

export type PrintCssOptions = { widthMm: number; heightMm: number };

export function buildPrintCss({ widthMm, heightMm }: PrintCssOptions): string {
  return `
:root {
  --page-w: ${widthMm}mm;
  --page-h: ${heightMm}mm;
  --margin-x: 14mm;
  --margin-top: 17mm;
  --margin-bottom: 15mm;
  --gutter: 4.5mm;
  --navy: #10203A;
  --navy-2: #1E2A44;
  --ink: #17191c;
  --charcoal: #202932;
  --grey: #7B7B7B;
  --grey-2: #a3a7ad;
  --rule: #d5d7db;
  --paper: #ffffff;
  --tint: #f2f3f5;
  --blue: #2BAFE0;
  --section: var(--navy);
  --font-display: "Fraunces", "Georgia", serif;
  --font-text: "Newsreader", "Georgia", serif;
  --font-sans: "Inter", "Helvetica Neue", Arial, sans-serif;
  --font-mono: "IBM Plex Mono", "Menlo", monospace;
}

@page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }

html, body { margin: 0; padding: 0; background: var(--paper); }
body {
  font-family: var(--font-text);
  color: var(--ink);
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
  font-kerning: normal;
  font-variant-ligatures: common-ligatures;
  text-rendering: geometricPrecision;
}
* { box-sizing: border-box; }
img { display: block; max-width: 100%; }
p { margin: 0; }
a { color: inherit; text-decoration: none; }

/* ── Page container ─────────────────────────────────────────────────────── */
.page {
  position: relative;
  width: var(--page-w);
  height: var(--page-h);
  overflow: hidden;
  background: var(--paper);
  break-after: page;
  break-inside: avoid;
  page-break-after: always;
}
.page:last-child { break-after: auto; page-break-after: auto; }
.sheet {
  position: absolute;
  left: var(--margin-x);
  right: var(--margin-x);
  top: var(--margin-top);
  bottom: var(--margin-bottom);
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.sheet > * { flex: none; }
.sheet > .grow { flex: 1 1 0; min-height: 0; }
.sheet > .fill { flex: 1 1 0; min-height: 0; display: flex; flex-direction: column; }

/* Running header + folio */
.running {
  position: absolute;
  top: 8.5mm;
  left: var(--margin-x);
  right: var(--margin-x);
  display: flex;
  justify-content: space-between;
  align-items: center;
  font: 500 7pt/1 var(--font-sans);
  letter-spacing: 0.04em;
  color: var(--grey);
  text-transform: uppercase;
}
.running .mark { display: inline-block; width: 2.6mm; height: 2.6mm; background: var(--section); margin-right: 2mm; vertical-align: -0.4mm; }
.running .left { color: var(--charcoal); }
.folio {
  position: absolute;
  bottom: 7.5mm;
  font: 600 8pt/1 var(--font-sans);
  color: var(--charcoal);
  letter-spacing: 0.02em;
}
.page.odd .folio { right: var(--margin-x); }
.page.even .folio { left: var(--margin-x); }
.section-bar { position: absolute; top: 0; left: 0; right: 0; height: 1.4mm; background: var(--section); }
.page.cover .running, .page.cover .folio, .page.cover .section-bar { display: none; }

/* ── Grid helpers ──────────────────────────────────────────────────────── */
.grid { display: grid; grid-template-columns: repeat(12, 1fr); column-gap: var(--gutter); }
.span-3 { grid-column: span 3; } .span-4 { grid-column: span 4; } .span-5 { grid-column: span 5; }
.span-6 { grid-column: span 6; } .span-7 { grid-column: span 7; } .span-8 { grid-column: span 8; }
.span-9 { grid-column: span 9; } .span-12 { grid-column: span 12; }
.row-gap { row-gap: 4mm; }

/* ── Type scale ────────────────────────────────────────────────────────── */
.kicker {
  font: 600 8pt/1.2 var(--font-sans);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--section);
  margin: 0 0 2.4mm;
}
.kicker .dot { display: inline-block; width: 1.6mm; height: 1.6mm; border-radius: 50%; background: var(--section); margin-right: 1.6mm; vertical-align: 0.2mm; }
.headline {
  font-family: var(--font-display);
  font-weight: 600;
  font-variation-settings: "opsz" 72;
  font-size: 30pt;
  line-height: 1.02;
  letter-spacing: -0.022em;
  color: var(--navy);
  margin: 0 0 3mm;
  text-wrap: balance;
}
.headline.xl { font-size: 38pt; letter-spacing: -0.025em; }
.headline.lg { font-size: 34pt; }
.headline.md { font-size: 26pt; }
.headline.sm { font-size: 20pt; line-height: 1.06; }
.headline.xs { font-size: 15.5pt; line-height: 1.08; letter-spacing: -0.012em; }
.headline.quote { font-style: italic; font-weight: 500; }
.standfirst {
  font: 500 12.5pt/1.32 var(--font-text);
  color: var(--charcoal);
  margin: 0 0 3.2mm;
  text-wrap: pretty;
}
.standfirst.sm { font-size: 10.5pt; line-height: 1.3; }
.byline-top {
  font: 500 7.6pt/1.3 var(--font-sans);
  color: var(--grey);
  letter-spacing: 0.02em;
  margin: 0 0 3mm;
  display: flex; gap: 4mm; flex-wrap: wrap;
}
.byline-top b { color: var(--charcoal); font-weight: 600; }
.header-rule { border: 0; border-top: 0.35mm solid var(--navy); margin: 0 0 3.2mm; }
.header-rule.thin { border-top-width: 0.2mm; border-color: var(--rule); }

/* ── Flowing text ─────────────────────────────────────────────────────── */
.flow {
  position: relative;
  overflow: hidden;
  column-fill: auto;
  column-gap: var(--gutter);
  column-rule: 0.15mm solid var(--rule);
  font: 400 9.6pt/13pt var(--font-text);
  text-align: justify;
  hyphens: auto;
  -webkit-hyphens: auto;
  hyphenate-limit-chars: 7 3 3;
  orphans: 2; widows: 2;
}
.flow.cols-1 { column-count: 1; column-rule: none; }
.flow.cols-2 { column-count: 2; }
.flow.cols-3 { column-count: 3; }
.flow.cols-4 { column-count: 4; }
.flow.compact { font-size: 9.1pt; line-height: 12.2pt; }
.flow.wide { font-size: 10pt; line-height: 13.8pt; }
.blk { margin: 0 0 6.5pt; break-inside: auto; }
.blk.para { text-indent: 0; }
.blk.para + .blk.para { text-indent: 3.4mm; margin-top: -2.5pt; }
.flow .drop::first-letter {
  font-family: var(--font-display); font-weight: 600; font-size: 34pt; line-height: 0.78;
  float: left; padding: 1.2mm 1.6mm 0 0; color: var(--section);
}
.blk.crosshead {
  font: 700 8.5pt/1.2 var(--font-sans);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--charcoal);
  margin: 4pt 0 3pt;
  break-after: avoid;
  text-align: left;
  hyphens: manual;
}
.blk.crosshead::before { content: ""; display: block; width: 6mm; height: 0.5mm; background: var(--section); margin-bottom: 1.6mm; }
.blk.pullquote {
  break-inside: avoid;
  margin: 5pt 0 7pt;
  padding: 2.4mm 0 2.2mm;
  border-top: 0.35mm solid var(--section);
  border-bottom: 0.2mm solid var(--rule);
  font: italic 500 15pt/1.18 var(--font-display);
  font-variation-settings: "opsz" 36;
  color: var(--navy);
  text-align: left;
  hyphens: manual;
  letter-spacing: -0.01em;
}
.blk.pullquote .attr { display: block; margin-top: 1.8mm; font: 600 7.2pt/1.2 var(--font-sans); font-style: normal; letter-spacing: 0.08em; text-transform: uppercase; color: var(--grey); }
.blk.list { padding-left: 4mm; margin: 0 0 6.5pt; text-align: left; }
.blk.list li { margin: 0 0 2pt; padding-left: 0.6mm; }
.blk.list li::marker { color: var(--section); font-weight: 600; }
.blk.list.ordered li::marker { font-family: var(--font-mono); font-size: 8pt; }
.blk.box {
  break-inside: avoid;
  background: var(--tint);
  border-top: 0.6mm solid var(--section);
  padding: 2.6mm 3mm 2.4mm;
  margin: 3pt 0 7pt;
  text-align: left;
  hyphens: manual;
  font-size: 8.8pt; line-height: 11.8pt;
}
.blk.box .box-title { font: 700 8pt/1.2 var(--font-sans); letter-spacing: 0.1em; text-transform: uppercase; color: var(--section); margin: 0 0 1.8mm; }
.blk.box ul { margin: 0; padding-left: 3.6mm; }
.blk.box li { margin: 0 0 1.2pt; }
.blk.box li::marker { color: var(--section); }
.blk.qa { text-align: left; }
.blk.qa .q { font: 700 8.6pt/1.25 var(--font-sans); letter-spacing: 0.04em; text-transform: uppercase; color: var(--section); margin: 3pt 0 2.2pt; break-after: avoid; hyphens: manual; }
.blk.qa .a { text-align: justify; }
.blk.qa .a p + p { text-indent: 3.4mm; }
.blk.testimony { padding-left: 3mm; border-left: 0.5mm solid var(--section); font-style: italic; text-align: left; hyphens: manual; }
.blk.testimony .speaker { display: block; font: 600 7.2pt/1.2 var(--font-sans); font-style: normal; letter-spacing: 0.08em; text-transform: uppercase; color: var(--grey); margin-top: 1.4mm; }
.blk.testimony + .blk.testimony { margin-top: -1pt; }
.blk.testimony + .blk.testimony .speaker.repeat { display: none; }
.blk.divider { border: 0; border-top: 0.2mm solid var(--rule); height: 0; margin: 4pt 0 8pt; width: 40%; }
.blk.byline {
  font: 600 8pt/1.2 var(--font-sans);
  text-align: right;
  color: var(--charcoal);
  margin-top: 4pt;
  hyphens: manual;
  break-inside: avoid;
}
.blk.byline::before { content: ""; display: inline-block; width: 6mm; height: 0.35mm; background: var(--section); vertical-align: middle; margin-right: 2mm; }
.blk.figure { break-inside: avoid; margin: 2pt 0 7pt; }
.blk.figure.inline { width: 100%; }
.blk.figure.wide, .blk.figure.full { column-span: all; }
.blk.figure img { width: 100%; height: auto; }
.blk.continued-from { font: 600 7.5pt/1.2 var(--font-sans); letter-spacing: 0.1em; text-transform: uppercase; color: var(--grey); margin: 0 0 3pt; hyphens: manual; text-align: left; }
.blk.run-in { margin: 0 0 4pt; text-align: left; hyphens: manual; }
.blk.run-in .kicker { margin-bottom: 1mm; }
.blk.run-in .headline { margin-bottom: 1.2mm; }
.jump { position: absolute; right: 0; bottom: 0; font: 600 7pt/1.2 var(--font-sans); letter-spacing: 0.06em; text-transform: uppercase; color: var(--section); background: var(--paper); padding: 0.8mm 0 0 2mm; }

/* ── Figures & captions ───────────────────────────────────────────────── */
.figure { position: relative; overflow: hidden; }
.figure img { width: 100%; height: 100%; object-fit: cover; }
.figure.contain img { object-fit: contain; }
.figure.tinted { background: var(--tint); }
.caption {
  font: 400 7.2pt/1.3 var(--font-sans);
  color: var(--charcoal);
  margin-top: 1.4mm;
  text-align: left;
  hyphens: manual;
}
.caption .credit { color: var(--grey); white-space: nowrap; }
.caption .credit::before { content: " "; }
.caption.on-image { position: absolute; left: 0; right: 0; bottom: 0; margin: 0; padding: 4mm 3mm 2.4mm; color: #fff; background: linear-gradient(to top, rgba(0,0,0,.62), rgba(0,0,0,0)); }
.caption.on-image .credit { color: rgba(255,255,255,.8); }
.figure-block { margin-bottom: 4mm; }
.fig-h { width: 100%; }

/* ── Section colour helpers ──────────────────────────────────────────── */
.tag {
  display: inline-block; font: 600 6.8pt/1 var(--font-sans); letter-spacing: 0.1em; text-transform: uppercase;
  color: var(--paper); background: var(--section); padding: 1.2mm 1.8mm 1mm; margin-right: 1.2mm;
}
.chip { display: inline-block; font: 500 7pt/1 var(--font-mono); color: var(--charcoal); background: var(--tint); padding: 1.2mm 1.6mm; margin: 0 1.2mm 1.2mm 0; }
.mono { font-family: var(--font-mono); }
.label {
  font: 700 7pt/1.2 var(--font-sans); letter-spacing: 0.12em; text-transform: uppercase; color: var(--section);
}

/* ── Cover ─────────────────────────────────────────────────────────────── */
.page.cover { background: var(--navy); color: #fff; }
.cover-photo { position: absolute; inset: 0; }
.cover-photo img { width: 100%; height: 100%; object-fit: cover; }
.cover-photo::after { content: ""; position: absolute; inset: 0; background: linear-gradient(to bottom, rgba(16,32,58,.55) 0%, rgba(16,32,58,0) 30%, rgba(16,32,58,0) 48%, rgba(16,32,58,.86) 72%, rgba(16,32,58,.97) 100%); }
.cover-band .cover-photo { inset: 0 0 auto 0; height: 58%; }
.cover-band .cover-photo::after { background: linear-gradient(to bottom, rgba(16,32,58,.5) 0%, rgba(16,32,58,0) 35%, rgba(16,32,58,0) 70%, rgba(16,32,58,1) 100%); }
.cover-inner { position: absolute; inset: 12mm var(--margin-x) 12mm; display: flex; flex-direction: column; }
.masthead { display: flex; align-items: flex-start; gap: 5mm; }
.masthead .word {
  font-family: var(--font-display); font-weight: 900; font-variation-settings: "opsz" 144; line-height: 0.82;
  letter-spacing: -0.02em; text-transform: uppercase; color: #fff; display: block;
}
.masthead .word.outline { color: transparent; -webkit-text-stroke: 0.45mm #fff; }
.masthead .word.big { font-size: 62pt; }
.masthead .word.big2 { font-size: 62pt; margin-top: 1mm; }
.masthead .logo-mark { position: relative; width: 16mm; height: 16mm; border-radius: 50%; background: var(--blue); flex: none; margin-top: 2mm; }
.masthead .logo-mark::after { content: ""; position: absolute; width: 5.2mm; height: 5.2mm; border-radius: 50%; background: var(--navy-2); right: -1mm; top: -0.5mm; border: 0.8mm solid #fff; }
.masthead-line { display: flex; justify-content: space-between; align-items: baseline; margin-top: 3mm; padding-top: 2.2mm; border-top: 0.35mm solid rgba(255,255,255,.75); font: 600 8pt/1.2 var(--font-sans); letter-spacing: 0.14em; text-transform: uppercase; color: #fff; }
.masthead-line .tagline { font-weight: 500; letter-spacing: 0.08em; text-transform: none; color: rgba(255,255,255,.85); font-family: var(--font-text); font-style: italic; font-size: 9.5pt; }
.cover-bottom { margin-top: auto; display: grid; grid-template-columns: 7fr 4fr; column-gap: 8mm; align-items: end; }
.cover-lead .kicker { color: var(--blue); margin-bottom: 2.2mm; }
.cover-lead .headline { color: #fff; font-size: 27pt; font-weight: 600; letter-spacing: -0.02em; line-height: 1.04; margin-bottom: 3mm; text-wrap: balance; }
.cover-lead .standfirst { color: rgba(255,255,255,.88); font-size: 10.6pt; line-height: 1.32; margin-bottom: 2mm; }
.cover-lead .pageref { font: 600 8pt/1.2 var(--font-sans); letter-spacing: 0.12em; text-transform: uppercase; color: var(--blue); }
.teasers { border-left: 0.3mm solid rgba(255,255,255,.55); padding-left: 4mm; }
.teasers .label { color: var(--blue); margin-bottom: 2.4mm; display: block; }
.teaser { display: grid; grid-template-columns: 1fr auto; column-gap: 3mm; align-items: baseline; padding: 1.8mm 0; border-top: 0.2mm solid rgba(255,255,255,.28); font: 500 9pt/1.22 var(--font-text); color: #fff; }
.teaser:first-of-type { border-top: 0; padding-top: 0; }
.teaser .pg { font: 600 7.5pt/1 var(--font-mono); color: var(--blue); }
.cover-b .cover-inner { color: var(--navy); }
.page.cover.cover-b { background: var(--paper); color: var(--navy); }
.cover-b .masthead .word { color: var(--navy); }
.cover-b .masthead .word.outline { color: transparent; -webkit-text-stroke: 0.45mm var(--navy); }
.cover-b .masthead-line { border-top-color: var(--navy); color: var(--navy); }
.cover-b .masthead-line .tagline { color: var(--charcoal); }
.cover-b .cover-lead .headline { color: var(--navy); font-size: 40pt; }
.cover-b .cover-lead .standfirst { color: var(--charcoal); }
.cover-b .teasers { border-left-color: var(--rule); }
.cover-b .teaser { color: var(--navy); border-top-color: var(--rule); }
.cover-b .teaser-figs { display: grid; grid-template-columns: repeat(3, 1fr); column-gap: var(--gutter); margin: 6mm 0; }
.cover-b .teaser-figs .figure { height: 52mm; }

/* ── Contents page ─────────────────────────────────────────────────────── */
.masthead-small { display: flex; align-items: center; gap: 3mm; }
.masthead-small .word { font-family: var(--font-display); font-weight: 900; font-variation-settings: "opsz" 144; font-size: 21pt; line-height: 1; letter-spacing: -0.01em; text-transform: uppercase; color: var(--navy); }
.masthead-small .word.outline { color: transparent; -webkit-text-stroke: 0.25mm var(--navy); }
.masthead-small .logo-mark { position: relative; width: 7mm; height: 7mm; border-radius: 50%; background: var(--blue); flex: none; }
.masthead-small .logo-mark::after { content: ""; position: absolute; width: 2.4mm; height: 2.4mm; border-radius: 50%; background: var(--navy-2); right: -0.5mm; top: -0.3mm; border: 0.4mm solid #fff; }
.issue-line { font: 600 8pt/1.2 var(--font-sans); letter-spacing: 0.14em; text-transform: uppercase; color: var(--grey); margin: 2.4mm 0 0; }
.contents-head { display: flex; justify-content: space-between; align-items: flex-end; padding-bottom: 3mm; border-bottom: 0.5mm solid var(--navy); margin-bottom: 5mm; }
.contents-title { font-family: var(--font-display); font-weight: 700; font-size: 44pt; line-height: 0.9; letter-spacing: -0.02em; color: var(--navy); text-transform: uppercase; }
.editorial { font: 400 10.2pt/14pt var(--font-text); text-align: justify; hyphens: auto; }
.editorial .label { display: block; margin-bottom: 2.4mm; }
.editorial p { margin-bottom: 6pt; }
.editorial .drop::first-letter { font-family: var(--font-display); font-weight: 600; font-size: 40pt; line-height: 0.76; float: left; padding: 1.4mm 1.8mm 0 0; color: var(--navy); }
.editorial .sign { font: 600 7.5pt/1.3 var(--font-sans); letter-spacing: 0.08em; text-transform: uppercase; color: var(--grey); margin-top: 3mm; }
.toc-section { margin-bottom: 3.6mm; break-inside: avoid; }
.toc-section .sec { display: flex; align-items: center; gap: 2mm; font: 700 7.6pt/1.2 var(--font-sans); letter-spacing: 0.12em; text-transform: uppercase; color: var(--section); margin-bottom: 1.4mm; }
.toc-section .sec::after { content: ""; flex: 1; height: 0.2mm; background: var(--rule); }
.toc-line { display: flex; align-items: baseline; gap: 2mm; font: 500 9.2pt/1.25 var(--font-text); color: var(--ink); padding: 1mm 0; }
.toc-line .t { flex: none; max-width: 86%; }
.toc-line .dots { flex: 1; border-bottom: 0.2mm dotted var(--grey-2); transform: translateY(-1mm); min-width: 4mm; }
.toc-line .pg { flex: none; font: 600 8pt/1 var(--font-mono); color: var(--navy); min-width: 5mm; text-align: right; }
.credits { border-top: 0.35mm solid var(--navy); padding-top: 3mm; display: grid; grid-template-columns: repeat(3, 1fr); column-gap: var(--gutter); font: 400 7.6pt/1.4 var(--font-sans); color: var(--charcoal); }
.credits .label { display: block; margin-bottom: 1mm; }
.credits b { font-weight: 600; }
.contents-figure { height: 60mm; margin-bottom: 4mm; }

/* ── Section opener ───────────────────────────────────────────────────── */
.opener-photo { position: absolute; inset: 0; }
.opener-photo img { width: 100%; height: 100%; object-fit: cover; }
.opener-photo::after { content: ""; position: absolute; inset: 0; background: linear-gradient(to top, rgba(16,32,58,.92) 0%, rgba(16,32,58,.35) 45%, rgba(16,32,58,.1) 100%); }
.opener-inner { position: absolute; inset: var(--margin-top) var(--margin-x) var(--margin-bottom); color: #fff; display: flex; flex-direction: column; justify-content: flex-end; }
.opener-inner .kicker { color: var(--blue); }
.opener-title { font-family: var(--font-display); font-weight: 700; font-size: 64pt; line-height: 0.88; letter-spacing: -0.02em; text-transform: uppercase; margin: 0 0 6mm; text-wrap: balance; }
.opener-list { display: grid; grid-template-columns: 1fr 1fr; column-gap: var(--gutter); row-gap: 1.6mm; border-top: 0.35mm solid rgba(255,255,255,.6); padding-top: 3mm; }
.opener-list .item { display: flex; gap: 3mm; font: 500 9pt/1.25 var(--font-text); }
.opener-list .pg { font: 600 8pt/1.3 var(--font-mono); color: var(--blue); flex: none; }
.page.opener .running { color: rgba(255,255,255,.85); } .page.opener .running .left { color: #fff; } .page.opener .folio { color: #fff; }

/* ── Article templates ────────────────────────────────────────────────── */
.hero-figure { width: 100%; margin-bottom: 4mm; }
.article-head { margin-bottom: 3mm; }
.article-head.rule { border-bottom: 0.2mm solid var(--rule); padding-bottom: 3mm; margin-bottom: 4mm; }
.side { display: flex; flex-direction: column; gap: 4mm; }
.side .figure { width: 100%; }
.pull-side {
  border-top: 0.5mm solid var(--section); padding-top: 2.6mm;
  font: italic 500 14pt/1.2 var(--font-display); font-variation-settings: "opsz" 36; color: var(--navy); letter-spacing: -0.01em;
}
.pull-side .attr { display: block; margin-top: 2mm; font: 600 7.2pt/1.2 var(--font-sans); font-style: normal; letter-spacing: 0.08em; text-transform: uppercase; color: var(--grey); }
.side-box { background: var(--tint); border-top: 0.6mm solid var(--section); padding: 2.8mm 3mm 2.6mm; font: 400 8.8pt/11.8pt var(--font-text); }
.side-box .box-title { font: 700 8pt/1.2 var(--font-sans); letter-spacing: 0.1em; text-transform: uppercase; color: var(--section); margin: 0 0 2mm; }
.side-box ul { margin: 0; padding-left: 3.6mm; } .side-box li { margin: 0 0 1.4pt; } .side-box li::marker { color: var(--section); }
.side-box p + p { margin-top: 1.5mm; }
.head-band { display: grid; grid-template-columns: 5fr 7fr; column-gap: var(--gutter); margin-bottom: 4mm; align-items: stretch; }
.head-band .figure { height: 100%; min-height: 60mm; }
.two-up { display: grid; grid-template-columns: 1fr 1fr; column-gap: var(--gutter); margin-bottom: 4mm; align-items: start; }

/* ── BDD ───────────────────────────────────────────────────────────────── */
.bdd-top { display: grid; grid-template-columns: 26mm 1fr auto; column-gap: 5mm; align-items: start; padding-bottom: 3mm; border-bottom: 0.5mm solid var(--navy); margin-bottom: 3.6mm; }
.bdd-logo { width: 26mm; height: 16mm; background: var(--paper); border: 0.2mm solid var(--rule); padding: 1.2mm; }
.bdd-logo img { width: 100%; height: 100%; object-fit: contain; }
.bdd-date { font: 500 7.4pt/1.35 var(--font-mono); color: var(--grey); text-align: right; max-width: 42mm; }
.bdd-date b { display: block; color: var(--navy); font-weight: 600; }
.case-panel { background: var(--tint); padding: 3.2mm 3.4mm 2.4mm; border-top: 0.7mm solid var(--section); font: 400 8.4pt/11.2pt var(--font-text); }
.case-panel .item { margin-bottom: 2.2mm; break-inside: avoid; }
.case-panel .label { display: block; margin-bottom: 0.7mm; }
.case-panel .names { font-weight: 500; }
.case-panel .chips { margin-top: 0.6mm; }
.case-panel .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(22mm, 1fr)); gap: 2mm; margin-bottom: 2.4mm; }
.case-panel .metric { border-left: 0.5mm solid var(--section); padding-left: 2mm; }
.case-panel .metric .v { font-family: var(--font-display); font-weight: 600; font-size: 16pt; line-height: 1; color: var(--navy); letter-spacing: -0.02em; }
.case-panel .metric .l { font: 500 6.6pt/1.2 var(--font-sans); color: var(--grey); text-transform: uppercase; letter-spacing: 0.06em; margin-top: 1mm; }
.case-panel .takeaways { margin: 0; padding-left: 3.4mm; } .case-panel .takeaways li { margin-bottom: 1pt; } .case-panel .takeaways li::marker { color: var(--section); }
.bdd-mid { display: grid; grid-template-columns: 5fr 7fr; column-gap: var(--gutter); margin-bottom: 4mm; align-items: start; }
.visual-grid { display: grid; grid-template-columns: 1fr 1fr; column-gap: var(--gutter); row-gap: 3.6mm; margin-bottom: 4mm; }
.visual-grid .figure-block.full { grid-column: span 2; }
.visual-grid .figure { background: var(--tint); }
.visual-grid .figure img { object-fit: contain; }

/* ── News grid / shorts / event / photo / quote / back page ───────────── */
.news-grid { display: grid; column-gap: var(--gutter); flex: 1 1 0; min-height: 0; }
.news-grid.n-1 { grid-template-columns: 1fr; }
.news-grid.n-2 { grid-template-columns: 1fr 1fr; }
.news-grid.n-3 { grid-template-columns: 1fr 1fr 1fr; }
.news-grid.n-4 { grid-template-columns: 1fr 1fr 1fr 1fr; }
.news-item { display: flex; flex-direction: column; min-height: 0; border-left: 0.2mm solid var(--rule); padding-left: var(--gutter); }
.news-item:first-child { border-left: 0; padding-left: 0; }
.news-item .figure { height: 34mm; margin-bottom: 2.4mm; }
.news-item .headline { font-size: 15.5pt; line-height: 1.08; margin-bottom: 2mm; }
.news-item .standfirst { font-size: 9.2pt; line-height: 1.3; margin-bottom: 2.4mm; }
.news-item .flow { flex: 1 1 0; min-height: 0; }
.news-item .kicker { margin-bottom: 1.6mm; }
.digest-head { border-bottom: 0.5mm solid var(--navy); padding-bottom: 3mm; margin-bottom: 4mm; }
.flow.shorts .blk.crosshead { font-family: var(--font-display); font-weight: 900; font-size: 18pt; line-height: 1; letter-spacing: -0.02em; text-transform: uppercase; color: var(--section); margin: 6pt 0 3pt; }
.flow.shorts .blk.crosshead::before { display: none; }
.flow.shorts .blk.para { font-size: 9.8pt; line-height: 13.4pt; }
.flow.shorts .blk.para + .blk.para { text-indent: 0; margin-top: 0; }
.event-cards { display: grid; grid-template-columns: repeat(3, 1fr); column-gap: var(--gutter); margin-bottom: 4mm; }
.event-card { border-top: 0.7mm solid var(--section); padding-top: 2.6mm; font: 400 9.4pt/12.8pt var(--font-text); }
.event-card .label { display: block; font-family: var(--font-display); font-weight: 700; font-size: 15pt; letter-spacing: -0.01em; text-transform: uppercase; color: var(--section); margin-bottom: 1.8mm; }
.event-box { background: var(--navy); color: #fff; padding: 4mm 4.5mm; display: grid; grid-template-columns: 1fr 1fr; column-gap: 6mm; align-items: center; margin-bottom: 4mm; }
.event-box .when { font-family: var(--font-display); font-weight: 600; font-size: 22pt; line-height: 1.05; letter-spacing: -0.02em; }
.event-box .meta { font: 500 8.4pt/1.45 var(--font-sans); color: rgba(255,255,255,.88); }
.event-box .meta b { display: block; color: var(--blue); font: 600 7pt/1.2 var(--font-sans); letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 0.8mm; }
.event-box .meta + .meta { margin-top: 2mm; }
.photo-grid { display: grid; grid-template-columns: repeat(2, 1fr); column-gap: var(--gutter); row-gap: 3.6mm; margin-bottom: 4mm; }
.photo-grid .figure-block.wide { grid-column: span 2; }
.quote-page .opener-photo::after { background: linear-gradient(to top, rgba(16,32,58,.94) 0%, rgba(16,32,58,.45) 55%, rgba(16,32,58,.15) 100%); }
.quote-page .big-quote { font: italic 500 30pt/1.14 var(--font-display); font-variation-settings: "opsz" 144; letter-spacing: -0.015em; color: #fff; margin-bottom: 5mm; text-wrap: balance; }
.quote-page .attr { font: 600 8.5pt/1.3 var(--font-sans); letter-spacing: 0.12em; text-transform: uppercase; color: var(--blue); }
.back-grid { display: grid; grid-template-columns: 8fr 4fr; column-gap: 6mm; flex: 1 1 0; min-height: 0; }
.back-grid .flow .blk.box { background: var(--paper); border: 0.25mm solid var(--navy); border-top-width: 1mm; }
.social-card { border-top: 0.7mm solid var(--section); padding-top: 3mm; margin-bottom: 4mm; }
.social-card .figure { height: 40mm; margin-bottom: 2.4mm; background: var(--tint); }
.social-card .figure img { object-fit: contain; }
.social-card .handle { font: 600 10pt/1.2 var(--font-sans); color: var(--navy); }
.social-card .hint { font: 400 8pt/1.35 var(--font-sans); color: var(--grey); margin-top: 1mm; }
.colophon { border-top: 0.5mm solid var(--navy); padding-top: 3mm; margin-top: 4mm; display: grid; grid-template-columns: repeat(4, 1fr); column-gap: var(--gutter); font: 400 7.4pt/1.45 var(--font-sans); color: var(--charcoal); }
.colophon .label { display: block; margin-bottom: 0.8mm; }
.colophon b { font-weight: 600; }
.colophon .masthead-small .word { font-size: 14pt; }
.placeholder { flex: 1 1 0; min-height: 0; border: 0.3mm dashed var(--grey-2); display: flex; align-items: center; justify-content: center; text-align: center; color: var(--grey); font: 500 9pt/1.4 var(--font-sans); padding: 10mm; }
.placeholder b { display: block; color: var(--charcoal); font-size: 11pt; margin-bottom: 2mm; }
.preview-flag { display: none; }
`;
}

/** Extra styles for the on-screen preview: grey desk, centred pages with a shadow, overflow markers. */
export const PREVIEW_CSS = `
html, body { background: #e9e9e6 !important; }
body { padding: 28px 0 40px; }
.page { margin: 0 auto 24px; box-shadow: 0 1px 2px rgba(0,0,0,.18), 0 12px 32px rgba(0,0,0,.16); }
.preview-flag { display: block; position: absolute; top: 4mm; left: 50%; transform: translateX(-50%); font: 600 8px/1 Inter, sans-serif; letter-spacing: .08em; text-transform: uppercase; color: #b42318; background: #fde8e8; border: 1px solid #f0b4b4; padding: 4px 8px; border-radius: 999px; z-index: 5; }
.flow.has-overflow { outline: 2px solid #d92d20; outline-offset: 2px; }
`;
