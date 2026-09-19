/**
 * What an edition is asking its contributors for.
 *
 * Briefly's contribution form has always been one fixed shape — a headline, a description, why it
 * matters, some photographs — which is exactly one of the three things an editor wants to say. It
 * is "tell us anything". The other two are "answer these questions" and "cover this topic", and a
 * newsroom that cannot say either of them is a newsroom sending twenty-eight people a blank page
 * and hoping.
 *
 * So a brief is a list of asks rather than a mode, because the interesting case is the mixed one:
 * *everybody send me one important piece of news and a photograph, and propose anything else you
 * like.* That is two asks and an open door, and it is what most editors actually mean.
 */

export const ASK_KINDS = ["QUESTION", "TOPIC"] as const;
export type AskKind = (typeof ASK_KINDS)[number];

/** What a contributor is expected to send back for one ask. */
export const ASK_WANTS = ["TEXT", "PHOTO"] as const;
export type AskWant = (typeof ASK_WANTS)[number];

export type Ask = {
  id: string;
  kind: AskKind;
  /** The question as it is asked, or the topic as it is assigned. */
  text: string;
  /** Guidance shown under it, when the text alone is not enough. */
  hint?: string;
  required: boolean;
  wants: AskWant[];
  /** A topic assigned to one person; null means it is asked of everybody. */
  contributorId?: string | null;
};

export type EditionBrief = {
  asks: Ask[];
  /**
   * Whether contributors may also propose something nobody asked for.
   *
   * On by default, and the default matters: the best thing in most issues is the thing the editor
   * did not know to ask about. Turning it off is for the months when the issue is a fixed shape.
   */
  openContributions: boolean;
};

export const EMPTY_BRIEF: EditionBrief = { asks: [], openContributions: true };

/** Whether this brief asks for anything in particular, or simply opens the door. */
export function isOpenOnly(brief: EditionBrief | null | undefined): boolean {
  return !brief?.asks.length;
}

export function questionsOf(brief: EditionBrief): Ask[] {
  return brief.asks.filter((ask) => ask.kind === "QUESTION");
}

export function topicsOf(brief: EditionBrief): Ask[] {
  return brief.asks.filter((ask) => ask.kind === "TOPIC");
}

/**
 * The asks one contributor sees: everything asked of everybody, plus the topics assigned to them.
 *
 * A topic assigned to somebody else is not their business, and showing it would invite two people
 * to write the same piece.
 */
export function asksFor(brief: EditionBrief, contributorId: string | null): Ask[] {
  return brief.asks.filter((ask) => !ask.contributorId || ask.contributorId === contributorId);
}

/** A short line for the editor's screen: "3 questions, 1 topic, open to anything else". */
export function describeBrief(brief: EditionBrief): string {
  const questions = questionsOf(brief).length;
  const topics = topicsOf(brief).length;
  const parts: string[] = [];
  if (questions) parts.push(`${questions} question${questions === 1 ? "" : "s"}`);
  if (topics) parts.push(`${topics} topic${topics === 1 ? "" : "s"}`);
  if (brief.openContributions) parts.push(parts.length ? "open to anything else" : "open to anything");
  return parts.length ? parts.join(", ") : "nothing asked yet";
}

/** What a brief looks like before it has been through `normaliseBrief`: ids optional, text untrimmed. */
export type RawBrief = {
  asks?: readonly (Partial<Omit<Ask, "wants">> & { wants?: readonly string[] })[];
  openContributions?: boolean;
};

/** Trim, drop the blanks, and give every ask an id, so what is stored is what will be shown. */
export function normaliseBrief(raw: RawBrief | null | undefined): EditionBrief {
  const asks = (raw?.asks ?? [])
    .map((ask, index) => ({
      id: ask.id?.trim() || `ask-${index + 1}`,
      kind: ((ASK_KINDS as readonly string[]).includes(ask.kind ?? "") ? ask.kind : "QUESTION") as AskKind,
      text: (ask.text ?? "").trim(),
      hint: ask.hint?.trim() || undefined,
      required: Boolean(ask.required),
      wants: (ask.wants ?? []).filter((want): want is AskWant => (ASK_WANTS as readonly string[]).includes(want)),
      contributorId: ask.contributorId ?? null,
    }))
    .filter((ask) => ask.text.length > 0)
    .map((ask) => ({ ...ask, wants: ask.wants.length ? ask.wants : (["TEXT"] as AskWant[]) }));
  return { asks, openContributions: raw?.openContributions ?? true };
}
