import type { DocumentPage, EditionDocument } from "@/lib/publication/document";
import { createTemplateContext, type AssetMode, type AssetSource, type TemplateContext } from "./context";
import { html, join, raw, type Html } from "./html";
import { imageScaleFactor, pageShell, type TemplateOutput } from "./parts";
import { articleHero, articleThreeColumn, articleTwoColumn, continuation, event, interview, newsGrid, photoStory, profile, shorts } from "./pages-article";
import { bddCase, bddVisual } from "./pages-bdd";
import { backPage, contents, coverA, coverB, quotePage, sectionOpener } from "./pages-front";
import { PREVIEW_CSS, buildPrintCss } from "./print-css";

/** Template registry: every page template code of PAGE_TEMPLATES plus the layout-generated CONTINUATION. */
export type PageTemplate = (page: DocumentPage, ctx: TemplateContext) => TemplateOutput;

export const TEMPLATES: Record<string, PageTemplate> = {
  COVER_A: coverA,
  COVER_B: coverB,
  CONTENTS: contents,
  SECTION_OPENER: sectionOpener,
  ARTICLE_HERO: articleHero,
  ARTICLE_TWO_COLUMN: articleTwoColumn,
  ARTICLE_THREE_COLUMN: articleThreeColumn,
  INTERVIEW: interview,
  PROFILE: profile,
  BDD_CASE: bddCase,
  BDD_VISUAL: bddVisual,
  PHOTO_STORY: photoStory,
  NEWS_GRID: newsGrid,
  SHORTS: shorts,
  EVENT: event,
  QUOTE_PAGE: quotePage,
  BACK_PAGE: backPage,
  CONTINUATION: continuation,
};

export const CONTINUATION_TEMPLATE = "CONTINUATION";

export function renderPageHtml(page: DocumentPage, ctx: TemplateContext): Html {
  const template = TEMPLATES[page.template] ?? TEMPLATES.ARTICLE_TWO_COLUMN;
  // Pages render in document order, so the context can carry this page's image-scale lever.
  ctx.imageScale = imageScaleFactor(page.imageScale ?? 0);
  const out = pageShell(page, ctx, template(page, ctx));
  ctx.imageScale = 1;
  return out;
}

export type DocumentHtmlOptions = {
  mode: AssetMode;
  assetSource: AssetSource;
  /** @font-face rules (data URIs for the PDF pass, /fonts URLs for the preview). */
  fontCss: string;
  /** Adds the on-screen preview stylesheet and the overflow-marker script. */
  preview?: boolean;
  /** Extra script injected before </body> (the pagination measurement pass). */
  script?: string;
  /** Chrome for the on-screen preview only: never in the print pass, never in a rendered file. */
  toolbar?: string;
};

export function renderDocumentHtml(doc: EditionDocument, options: DocumentHtmlOptions): string {
  const ctx = createTemplateContext(doc, options.mode, options.assetSource);
  const css = buildPrintCss({ widthMm: doc.meta.pageSize.widthMm, heightMm: doc.meta.pageSize.heightMm });
  const pages = join(doc.pages.map((p) => renderPageHtml(p, ctx)), "\n");
  const title = `${doc.meta.masthead.title} — ${doc.meta.issueLabel} (${doc.meta.versionLabel})`;
  return html`<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<meta name="generator" content="Briefly publication renderer" />
<style>${raw(options.fontCss)}</style>
<style>${raw(css)}</style>
${options.preview ? html`<style>${raw(PREVIEW_CSS)}</style>` : ""}
</head>
<body data-mode="${options.mode}" data-version="${doc.meta.versionLabel}">
${options.toolbar ? raw(options.toolbar) : ""}
${pages}
${options.script ? html`<script>${raw(options.script)}</script>` : ""}
${options.preview ? html`<script>${raw(PREVIEW_SCRIPT)}</script>` : ""}
</body>
</html>`.value;
}

/** Marks overflowing flows in the on-screen preview (measurement only — the real fix is the layout pass). */
export const PREVIEW_SCRIPT = `
(function () {
  function check() {
    document.querySelectorAll('.flow').forEach(function (flow) {
      var fr = flow.getBoundingClientRect();
      var overflow = 0;
      flow.querySelectorAll('[data-block]').forEach(function (b) {
        var rects = b.getClientRects();
        for (var i = 0; i < rects.length; i++) {
          if (rects[i].right > fr.right + 0.5 || rects[i].bottom > fr.bottom + 0.5) { overflow += 1; break; }
        }
      });
      flow.classList.toggle('has-overflow', overflow > 0);
      var page = flow.closest('.page');
      var flag = page && page.querySelector('[data-preview-flag]');
      if (flag) {
        var total = page.querySelectorAll('.flow.has-overflow').length;
        flag.textContent = total ? 'Overflow: ' + total + ' text area(s) need a continuation page' : '';
        flag.style.display = total ? 'block' : 'none';
      }
    });
  }
  if (document.fonts && document.fonts.ready) { document.fonts.ready.then(check); } else { check(); }
  window.addEventListener('load', check);
})();
`;

export { createTemplateContext } from "./context";
export type { TemplateContext, AssetMode, AssetSource } from "./context";
