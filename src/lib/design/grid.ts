import { gridSchema, type DesignGrid } from "./model";
import { IMPORTANCE_WEIGHT, type BlockRole, type Importance } from "./roles";
import type { ResolvedDirection } from "./identity";

/**
 * The grid, as a real editorial one rather than a CSS convenience.
 *
 * A grid is not "twelve columns because that is what frameworks do". It is the decision that makes
 * a publication look like a newspaper, a magazine or a report: how many columns the text runs in,
 * how wide a picture is allowed to be, what a sidebar is, and — most of all — what is *not*
 * allowed, because an element that may sit anywhere makes every page a fresh argument.
 *
 * One grid serves every medium. Twelve columns is twelve columns on A4 and in a browser; email
 * collapses to one and says so. What changes per medium is how a span is drawn, not what it means.
 */

export type GridShape = DesignGrid["shape"];

/**
 * What each shape is for.
 *
 * `columns` is the working grid; `textColumns` is how many the body sets in, which is the number a
 * reader actually feels. A twelve-column grid with single-column text is a magazine; the same grid
 * with three-column text is a newspaper.
 */
export const GRID_SHAPES: Record<GridShape, { columns: number; textColumns: number; description: string }> = {
  single: { columns: 6, textColumns: 1, description: "One column. A report, a letter, a long read." },
  "two-column": { columns: 8, textColumns: 2, description: "Two columns. The classic magazine measure." },
  "three-column": { columns: 12, textColumns: 3, description: "Three columns. A newspaper's density." },
  asymmetric: { columns: 12, textColumns: 1, description: "A wide column and a narrow rail: text with room for notes, captions and figures." },
  modular: { columns: 12, textColumns: 2, description: "A modular grid: blocks that tile, for issues made of many short pieces." },
  "digital-12": { columns: 12, textColumns: 1, description: "Twelve columns, one measure. The web's default and print's worst habit." },
};

/**
 * The grid a publication should be composed on, from what it is.
 *
 * Density decides how many columns the text runs in — that is the single most visible difference
 * between a quarterly report and a weekly paper — and the measure the direction resolved decides
 * whether that is even possible: three columns of 70-character lines do not fit on a page.
 */
export function gridForDirection(direction: ResolvedDirection, override?: Partial<DesignGrid>): DesignGrid {
  const { genome, measure } = direction;
  let shape: GridShape;
  if (genome.density > 0.72 && measure.ideal <= 62) shape = "three-column";
  else if (genome.density > 0.45) shape = "two-column";
  else if (genome.minimalism > 0.7) shape = "single";
  else shape = "asymmetric";

  // A publication made of many short pieces tiles better than it flows.
  if (genome.variation > 0.7 && genome.density > 0.5) shape = "modular";

  const base = GRID_SHAPES[shape];
  // Margins in columns-equivalent units; the renderers turn them into millimetres or rems. Airy
  // publications get more, and minimal ones get more still, because space is what minimalism is.
  const margin = Math.round((1.1 - genome.density * 0.5 + genome.minimalism * 0.45) * 100) / 100;
  return gridSchema.parse({
    columns: base.columns,
    gutter: Math.round((0.18 + (1 - genome.density) * 0.16) * 100) / 100,
    shape,
    baseline: genome.seriousness > 0.6 ? 0.25 : null,
    margins: { top: margin, right: margin, bottom: margin, left: margin },
    ...override,
  });
}

/** How many columns the body text of this publication runs in. */
export function textColumns(grid: DesignGrid): number {
  return GRID_SHAPES[grid.shape].textColumns;
}

export type Span = {
  /** Columns this block occupies, out of `grid.columns`. */
  span: number;
  /** Where it starts. Non-zero is an indent, which is a deliberate act and never an accident. */
  offset: number;
};

/**
 * How wide a block is, from what it is and how much it matters.
 *
 * The rule underneath: importance is expressed in space before it is expressed in type size. A lead
 * given a bigger headline on the same width reads as a bigger headline; a lead given the page reads
 * as the lead.
 */
export function spanFor(role: BlockRole, importance: Importance, grid: DesignGrid, options: { fullBleed?: boolean; hasPicture?: boolean } = {}): Span {
  const columns = grid.columns;
  const weight = IMPORTANCE_WEIGHT[importance];

  if (options.fullBleed) return { span: columns, offset: 0 };

  switch (role) {
    case "masthead":
    case "cover":
    case "section-opener":
    case "photo-spread":
    case "footer":
      return { span: columns, offset: 0 };
    case "hero":
    case "lead":
      return { span: columns, offset: 0 };
    case "feature":
      return { span: weight >= 0.65 ? columns : Math.round(columns * 0.75), offset: 0 };
    case "secondary":
      return { span: Math.max(3, Math.round(columns * (weight >= 0.45 ? 0.6 : 0.5))), offset: 0 };
    case "brief":
      return { span: Math.max(2, Math.round(columns / 3)), offset: 0 };
    case "brief-group":
    case "stat-group":
    case "events":
    case "contents":
      return { span: columns, offset: 0 };
    case "quote":
      // A quote indented from both sides is punctuation; one that fills the measure is a headline.
      return { span: Math.round(columns * 0.7), offset: Math.round(columns * 0.15) };
    case "pull-quote":
      return { span: Math.round(columns * 0.45), offset: 0 };
    case "sidebar":
      return { span: Math.max(2, Math.round(columns * 0.3)), offset: Math.round(columns * 0.7) };
    case "stat":
      return { span: Math.max(2, Math.round(columns / 4)), offset: 0 };
    case "portrait":
      return { span: Math.max(3, Math.round(columns * 0.35)), offset: 0 };
    case "photo":
      return { span: options.hasPicture ? Math.round(columns * 0.6) : Math.round(columns * 0.5), offset: 0 };
    case "photo-pair":
      return { span: columns, offset: 0 };
    case "photo-grid":
      return { span: columns, offset: 0 };
    case "table":
    case "chart":
    case "timeline":
      return { span: Math.round(columns * 0.8), offset: 0 };
    default:
      return { span: Math.round(columns * 0.7), offset: 0 };
  }
}

/**
 * The measure a block should set at, in characters.
 *
 * Derived from the span rather than fixed, because a column of text is only as wide as the grid
 * lets it be — and then held inside what typography tolerates, because a 140-character line is
 * unreadable however many columns it happens to occupy.
 */
export function measureFor(span: Span, grid: DesignGrid, direction: ResolvedDirection): { min: number; max: number } {
  const fraction = span.span / grid.columns;
  const columnsOfText = textColumns(grid);
  const perColumn = (fraction * direction.measure.ideal * 1.6) / columnsOfText;
  const ideal = Math.round(Math.min(direction.measure.max, Math.max(direction.measure.min, perColumn)));
  return { min: Math.max(34, Math.round(ideal * 0.8)), max: Math.min(96, Math.round(ideal * 1.2)) };
}

/** What the grid is, in a sentence, for the screen that explains the design. */
export function describeGrid(grid: DesignGrid): string {
  return GRID_SHAPES[grid.shape].description;
}
