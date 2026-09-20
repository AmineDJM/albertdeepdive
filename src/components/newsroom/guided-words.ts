/**
 * The path's words, in the dictionary.
 *
 * `GUIDED_PATH` is a plain data module — the server, the client and the tests all read it — so it
 * holds English literals rather than translated text. These are the same sentences written as
 * `tr("…")` call sites, because that is what the dictionary test scans: a screen added to the path
 * without its line here fails that test instead of reaching a French reader in English.
 */
export function screenWords(tr: (text: string) => string): Record<string, { question: string; cta: string }> {
  return {
    setup: { question: tr("What Briefly decided"), cta: tr("Validate") },
    ask: { question: tr("What are you asking for?"), cta: tr("Next") },
    who: { question: tr("Who are you asking?"), cta: tr("Next") },
    when: { question: tr("When for?"), cta: tr("Next") },
    pictures: { question: tr("Pictures"), cta: tr("Next") },
    topics: { question: tr("Which topics are going in?"), cta: tr("Next") },
    draft: { question: tr("The draft"), cta: tr("Next") },
    check: { question: tr("Everything checked"), cta: tr("Next") },
    send: { question: tr("Out into the world"), cta: tr("Next") },
  };
}
