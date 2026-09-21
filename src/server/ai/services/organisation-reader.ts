import { z } from "zod";
import { organizationTypes } from "@/lib/tenancy/types";
import { runService, type AiServiceContext } from "./common";

/**
 * Reading an organisation's own website the way a person would.
 *
 * What kind of organisation this is used to be decided by a regular expression: a page containing
 * the word "school" was a school, a page containing "ventures" was an investment firm. That gets a
 * law firm called Schoolcraft & Partners wrong, gets every French site wrong that says "école
 * supérieure" in a sentence the pattern does not match, and cannot answer at all when the words
 * are right but the meaning is not — "we teach teams to ship faster" is not a university.
 *
 * So the words go to a model that understands them, along with everything the page's structured
 * data already asserted. The model is asked only to *read*: to repeat what the site says about
 * itself. It is told, at some length, not to fill gaps — an organisation's founding year invented
 * by an assistant is worse than a blank field, because a blank field gets corrected.
 */

export const organisationReadingSchema = z.object({
  /** What it calls itself — not the page title, which is usually a slogan attached to a name. */
  name: z.string(),
  legalName: z.string().optional(),
  /** One line the organisation would recognise, in the language the site is written in. */
  headline: z.string(),
  description: z.string(),
  type: z.enum(organizationTypes),
  industry: z.string().optional(),
  /** A four-digit year as a string, or empty. A string because "since 1892" is not a number. */
  foundedYear: z.string().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
  /** Anything the page states about itself that the fields above have no room for. */
  alsoWorthKnowing: z.array(z.string()).optional(),
  /** What the site does not say, so the screen can ask instead of inventing. */
  notFound: z.array(z.string()).optional(),
});
export type OrganisationReading = z.infer<typeof organisationReadingSchema>;

export type OrganisationReaderInput = {
  website: string;
  /** What the structured data already asserted, so the model corroborates rather than guesses. */
  structured: string;
  /** The visible words of the home page. */
  text: string;
  types: readonly string[];
};

export async function readOrganisation(input: Omit<OrganisationReaderInput, "types">, ctx: AiServiceContext = {}) {
  return runService({
    service: "organisation_reader",
    schemaName: "organisation_reading",
    schema: organisationReadingSchema,
    input: { ...input, types: organizationTypes.join(", ") },
    ctx: { cacheable: true, ...ctx },
  });
}
