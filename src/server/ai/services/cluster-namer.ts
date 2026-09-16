import { z } from "zod";
import { runService, storyTypeSchema, STORY_TYPE_VALUES, type AiServiceContext } from "./common";

export const clusterNameSchema = z.object({
  title: z.string(),
  summary: z.string(),
  primaryStoryType: storyTypeSchema,
  contradictions: z.array(z.object({ topic: z.string(), statementA: z.string(), statementB: z.string(), submissionIds: z.array(z.string()) })),
});
export type ClusterNameOutput = z.infer<typeof clusterNameSchema>;

export type ClusterSubmissionInput = { id: string; title: string; text: string; storyType: string; contributor?: string | null };

function formatSubmissions(subs: ClusterSubmissionInput[]) {
  return subs.map((s) => `— Submission ${s.id} (${s.storyType}${s.contributor ? `, by ${s.contributor}` : ""})\nTitle: ${s.title}\n${s.text}`).join("\n\n");
}

/** Names a cluster, summarises what its submissions share and lists contradictions. */
export async function nameCluster(input: { submissions: ClusterSubmissionInput[] }, ctx: AiServiceContext = {}) {
  return runService({
    service: "cluster_namer",
    schemaName: "cluster_name",
    schema: clusterNameSchema,
    input: { submissions: formatSubmissions(input.submissions), submissionList: input.submissions, storyTypes: STORY_TYPE_VALUES },
    ctx,
  });
}
