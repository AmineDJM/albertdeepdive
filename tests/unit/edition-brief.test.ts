import { describe, expect, it } from "vitest";
import { EMPTY_BRIEF, asksFor, describeBrief, isOpenOnly, normaliseBrief, questionsOf, topicsOf } from "@/lib/campaigns/brief";

/**
 * What an edition is asking for, which until now it could not say.
 *
 * The contribution form has always been one fixed shape — a headline, a description, why it
 * matters, photographs — which is exactly one of the three things an editor wants to say, and it
 * is "tell us anything". The other two are "answer these questions" and "cover this topic", and a
 * newsroom that cannot say either is sending twenty-eight people a blank page and hoping.
 *
 * A brief is therefore a list of asks rather than a mode, because the interesting case is mixed:
 * everybody sends one piece of news and a photograph, and may propose anything else they like.
 */
const ask = (over: Record<string, unknown> = {}) => ({ id: "a1", kind: "QUESTION" as const, text: "What happened?", required: false, wants: ["TEXT" as const], contributorId: null, ...over });

describe("an edition's brief", () => {
  it("starts open, because the best thing is usually the thing nobody asked about", () => {
    expect(EMPTY_BRIEF.openContributions).toBe(true);
    expect(isOpenOnly(EMPTY_BRIEF)).toBe(true);
    expect(normaliseBrief(null).openContributions).toBe(true);
    expect(normaliseBrief(undefined).asks).toEqual([]);
  });

  it("mixes questions, topics and the open door, because that is what editors mean", () => {
    const brief = normaliseBrief({
      asks: [
        ask({ id: "q1", text: "One important piece of news from your corner", wants: ["TEXT", "PHOTO"] }),
        ask({ id: "t1", kind: "TOPIC", text: "The new campus opening", contributorId: "person-1" }),
      ],
      openContributions: true,
    });
    expect(questionsOf(brief)).toHaveLength(1);
    expect(topicsOf(brief)).toHaveLength(1);
    expect(describeBrief(brief)).toBe("1 question, 1 topic, open to anything else");
  });

  it("shows a contributor their own topic and not somebody else's", () => {
    // Two people sent the same assigned topic is two people writing the same piece.
    const brief = normaliseBrief({
      asks: [
        ask({ id: "q1", text: "Anything from your campus?" }),
        ask({ id: "t1", kind: "TOPIC", text: "Mine", contributorId: "me" }),
        ask({ id: "t2", kind: "TOPIC", text: "Theirs", contributorId: "them" }),
      ],
    });
    expect(asksFor(brief, "me").map((each) => each.id)).toEqual(["q1", "t1"]);
    expect(asksFor(brief, "them").map((each) => each.id)).toEqual(["q1", "t2"]);
    expect(asksFor(brief, null).map((each) => each.id), "somebody with no contributor record sees only what is asked of everybody").toEqual(["q1"]);
  });

  it("throws away the empty asks rather than asking a contributor a blank question", () => {
    const brief = normaliseBrief({ asks: [ask({ text: "   " }), ask({ id: "keep", text: "  A real question  " })] });
    expect(brief.asks).toHaveLength(1);
    expect(brief.asks[0].text, "and trims what it keeps").toBe("A real question");
  });

  it("always wants something back, defaulting to words", () => {
    const brief = normaliseBrief({ asks: [ask({ wants: [] }), ask({ id: "a2", wants: ["PHOTO", "NONSENSE"] })] });
    expect(brief.asks[0].wants).toEqual(["TEXT"]);
    expect(brief.asks[1].wants, "an unknown kind of answer is dropped, not stored").toEqual(["PHOTO"]);
  });

  it("gives every ask an id, because the answers have to point back at one", () => {
    const brief = normaliseBrief({ asks: [{ kind: "QUESTION", text: "No id here", required: false, wants: ["TEXT"] }] });
    expect(brief.asks[0].id).toBeTruthy();
  });

  it("says what it is in one line, for the screen that lists it", () => {
    expect(describeBrief(normaliseBrief({ asks: [], openContributions: true }))).toBe("open to anything");
    expect(describeBrief(normaliseBrief({ asks: [], openContributions: false }))).toBe("nothing asked yet");
    expect(describeBrief(normaliseBrief({ asks: [ask(), ask({ id: "a2", text: "And?" })], openContributions: false }))).toBe("2 questions");
  });
});
