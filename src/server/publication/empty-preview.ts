/**
 * The page the preview shows when there is no newsletter behind it yet.
 *
 * It opens in a new tab, away from the app's own shell, so it cannot borrow the interface's
 * components or its dictionary — it is a standalone document like the preview it stands in for.
 * Kept deliberately plain: this is not a screen anybody should want to linger on, it exists to
 * answer "why is this empty" in one sentence and hand back the two things worth doing instead.
 */
export function nothingToPreviewHtml(editionId: string, locale: "en" | "fr" = "en"): string {
  const t =
    locale === "fr"
      ? {
          title: "Rien à prévisualiser pour l'instant",
          lead: "Cette édition n'a pas encore d'article écrit. L'aperçu montre la newsletter telle qu'elle est — pour l'instant, elle est vide.",
          next: "Revenez quand un premier texte sera arrivé. D'ici là, vous pouvez voir à quoi elle ressemblera :",
          models: "Voir les modèles",
          back: "Retour à l'édition",
        }
      : {
          title: "Nothing to preview yet",
          lead: "This edition has no written article yet. The preview shows the newsletter as it stands — right now it stands empty.",
          next: "Come back once a first piece has arrived. In the meantime you can see what it will look like:",
          models: "See the models",
          back: "Back to the edition",
        };
  const safeId = encodeURIComponent(editionId);
  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t.title}</title>
<style>
  :root { color-scheme: light dark; --paper: #fbfaf8; --ink: #1a1a18; --muted: #6b6a66; --line: #e2e0db; }
  @media (prefers-color-scheme: dark) { :root { --paper: #15151a; --ink: #f2f1ee; --muted: #9b9a95; --line: #2c2c33; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
         background: var(--paper); color: var(--ink);
         font: 400 16px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 34rem; }
  h1 { margin: 0 0 .6rem; font-size: 1.4rem; font-weight: 600; letter-spacing: -0.01em; }
  p { margin: 0 0 1rem; color: var(--muted); }
  .row { display: flex; flex-wrap: wrap; gap: .6rem; margin-top: 1.4rem; }
  a { display: inline-block; padding: .5rem .9rem; border: 1px solid var(--line); border-radius: .55rem;
      text-decoration: none; color: inherit; font-size: .9rem; }
  a.primary { background: var(--ink); color: var(--paper); border-color: var(--ink); }
</style>
</head>
<body>
  <main>
    <h1>${t.title}</h1>
    <p>${t.lead}</p>
    <p>${t.next}</p>
    <div class="row">
      <a class="primary" href="/editions/${safeId}/models">${t.models}</a>
      <a href="/editions/${safeId}">${t.back}</a>
    </div>
  </main>
</body>
</html>`;
}
