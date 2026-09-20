import type { BrandTokens } from "@/lib/brand/system";
import type { DesignGrid } from "@/lib/design/model";
import { TYPE_ROLES } from "@/lib/design/model";
import { textColumns } from "@/lib/design/grid";
import type { TypeScale } from "@/lib/design/type-scale";
import type { ResolvedDirection } from "@/lib/design/identity";
import type { OutputMedium } from "@/lib/design/roles";

/**
 * The stylesheet a design compiles to.
 *
 * Every value here comes from the design: the type scale generated for this publication, the
 * surfaces the brand compiled with their contrast already proven, the grid the direction resolved.
 * Nothing is a constant chosen by whoever wrote the renderer, which is the difference between a
 * publication with a design system and a publication with a stylesheet.
 *
 * The compositions are the interesting part. `.b-lead.c-editorial-split` is not decoration on a
 * class name — it is the rule that makes an editorial split an editorial split, and a different
 * rule makes it a full-width image with the text below. That is what "the same role, drawn several
 * legitimate ways" means in CSS.
 */

export function designCss(options: { tokens: BrandTokens; scale: TypeScale; grid: DesignGrid; direction: ResolvedDirection; medium: OutputMedium }): string {
  const { tokens, scale, grid, direction, medium } = options;
  const columns = textColumns(grid);
  const unit = scale.unit;
  const space = (step: number) => `calc(var(--space) * ${Math.round(step * direction.spacing * 100) / 100})`;

  const typeRules = TYPE_ROLES.map((role) => {
    const style = scale.roles[role];
    return `.t-${role}{font-family:${style.stack};font-weight:${style.weight};font-size:${style.size}${unit};letter-spacing:${(style.tracking * style.size).toFixed(3)}${unit};line-height:${style.leading};${style.case === "upper" ? "text-transform:uppercase;" : ""}}`;
  }).join("\n");

  const surfaceRules = Object.values(tokens.surfaces)
    .map((surface) => `.s-${surface.key}{background:${surface.background};color:${surface.foreground};--rule:${surface.rule};--subdued:${surface.subdued};--highlight:${surface.highlight};}`)
    .join("\n");

  return `
:root{
  --space:${tokens.shape.unit}px;
  --gutter:${grid.gutter * 100}%;
  --columns:${grid.columns};
  --radius:${tokens.shape.radiusSm}px;
  --border:${tokens.shape.borderWidth}px;
  --paper:${tokens.surfaces.paper.background};
  --ink:${tokens.surfaces.paper.foreground};
  --rule:${tokens.surfaces.paper.rule};
  --subdued:${tokens.surfaces.paper.subdued};
  --highlight:${tokens.surfaces.paper.highlight};
  --measure:${direction.measure.ideal}ch;
}
*{box-sizing:border-box;}
body{margin:0;background:var(--paper);color:var(--ink);font-family:${scale.roles.body.stack};font-size:${scale.roles.body.size}${unit};line-height:${scale.roles.body.leading};-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;}
img{max-width:100%;display:block;}
figure{margin:0;}
h1,h2,h3,h4,p,ul,ol,blockquote{margin:0;}
a{color:inherit;}

${typeRules}
${surfaceRules}

/* ── The grid ──────────────────────────────────────────────────────────────────────────── */
.edition{max-width:${medium === "print" ? "none" : "1180px"};margin:0 auto;padding:0 ${space(2)};}
.surface{display:grid;grid-template-columns:repeat(var(--columns),1fr);column-gap:var(--gutter);align-items:start;padding:${space(3)} 0;}
.surface + .surface{border-top:${direction.ornament > 0.3 ? "var(--border) solid var(--rule)" : "0"};}
.block{grid-column:span var(--span,${grid.columns});display:flex;flex-direction:column;gap:${space(1)};}
.block[data-bleed="true"]{grid-column:1 / -1;}

/* Body copy runs in the publication's own number of columns, and never wider than its measure. */
.body{column-count:${columns};column-gap:var(--gutter);max-width:${columns === 1 ? "var(--measure)" : "none"};}
.body p + p{margin-top:${space(0.75)};text-indent:${columns > 1 && direction.genome.formality > 0.6 ? "1.2em" : "0"};}
.body p:first-child{text-indent:0;}
.deck{max-width:var(--measure);color:var(--subdued);}
.byline,.credit,.caption{color:var(--subdued);}
.caption{margin-top:${space(0.5)};}
.kicker{color:var(--highlight);}
.rule-above{border-top:var(--border) solid var(--rule);padding-top:${space(1)};}
.rule-below{border-bottom:var(--border) solid var(--rule);padding-bottom:${space(1)};}

/* ── Compositions: the same role, drawn several legitimate ways ────────────────────────── */
.c-editorial-split{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:${space(2)};align-items:start;}
.c-editorial-split .headline{grid-column:1;}
.c-editorial-split figure{grid-column:2;grid-row:1 / span 3;}
.c-image-left-text-right{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);gap:${space(2)};align-items:start;}
.c-image-left-text-right figure{grid-column:1;grid-row:1 / span 6;}
.c-full-width-image-text-below figure{margin-bottom:${space(1.5)};}
.c-large-headline-small-image figure{max-width:38%;}
.c-full-bleed figure{margin:0 calc(-1 * ${space(2)});}
.c-full-bleed img{width:100%;object-fit:cover;}
.c-compact-image-top figure{margin-bottom:${space(0.75)};}
.c-image-side{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr);gap:${space(1.5)};align-items:start;}
.c-image-side figure{grid-row:1 / span 5;}
.c-text-only figure{display:none;}
.c-two-column .body{column-count:2;}
.c-three-column .body{column-count:3;}
.c-sidebar-right{display:grid;grid-template-columns:minmax(0,3fr) minmax(0,1fr);gap:${space(2)};}

.b-quote{text-align:${direction.genome.formality > 0.7 ? "left" : "center"};}
.b-quote .quote{max-width:28ch;${direction.genome.formality > 0.7 ? "" : "margin-inline:auto;"}}
.c-portrait-and-quote{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr);gap:${space(2)};align-items:center;text-align:left;}
.b-pull-quote{border-left:calc(var(--border) * 3) solid var(--highlight);padding-left:${space(1)};}

.b-stat-group{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:${space(2)};}
.b-stat .stat-value{font-variant-numeric:tabular-nums;}
.b-brief-group{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:${space(2)};}
.c-two-up{grid-template-columns:repeat(2,minmax(0,1fr));}
.c-three-up{grid-template-columns:repeat(3,minmax(0,1fr));}
.c-rail{grid-template-columns:1fr;}

.b-photo-grid{display:grid;gap:${space(1)};}
.c-two-by-two{grid-template-columns:repeat(2,1fr);}
.c-mosaic{grid-template-columns:repeat(3,1fr);}
.b-photo-pair{display:grid;grid-template-columns:repeat(2,1fr);gap:${space(1)};}
.c-unequal{grid-template-columns:2fr 1fr;}

.b-masthead{align-items:baseline;}
.c-classic .logo{letter-spacing:-0.02em;}
.c-stacked{text-align:center;}
.b-section-opener{padding:${space(4)} 0;}
.c-colour-field{background:${tokens.surfaces.brand.background};color:${tokens.surfaces.brand.foreground};padding:${space(3)};}
.b-cover{min-height:${medium === "print" ? "100%" : "70vh"};justify-content:flex-end;position:relative;}
.c-image-led figure{position:absolute;inset:0;z-index:0;}
.c-image-led img{width:100%;height:100%;object-fit:cover;}
.c-image-led .headline,.c-image-led .deck,.c-image-led .kicker{position:relative;z-index:1;}
.b-footer{color:var(--subdued);}

/* ── Responsive: the hierarchy survives, the arrangement changes ────────────────────────── */
@media (max-width:900px){
  .surface{grid-template-columns:1fr;}
  .block{grid-column:1 / -1;}
  .body{column-count:1;max-width:none;}
  .c-editorial-split,.c-image-left-text-right,.c-image-side,.c-sidebar-right,.c-portrait-and-quote{grid-template-columns:1fr;}
  .c-editorial-split figure,.c-image-left-text-right figure,.c-image-side figure{grid-column:1;grid-row:auto;}
  .c-large-headline-small-image figure{max-width:100%;}
  .c-three-up,.c-two-by-two,.c-mosaic{grid-template-columns:1fr 1fr;}
}
@media (max-width:560px){
  .edition{padding:0 ${space(1.5)};}
  .c-three-up,.c-two-by-two,.c-mosaic,.b-photo-pair{grid-template-columns:1fr;}
}
@media print{
  .surface{break-inside:avoid;}
  .block[data-keep="true"]{break-inside:avoid;}
  .block[data-keep-with-next="true"]{break-after:avoid;}
}
`.trim();
}

/**
 * The classes one block is drawn with.
 *
 * Role first, composition second, so a stylesheet can say "every lead" and "this lead, drawn this
 * way" separately — and so the critic and the tests can find a block by what it is.
 */
export function blockClasses(role: string, composition: string, extra: string[] = []): string {
  return ["block", `b-${role}`, `c-${composition}`, ...extra].join(" ");
}
