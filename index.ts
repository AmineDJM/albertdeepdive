/**
 * Higgsfield · Seedance 2.5, text to video, end to end.
 *
 *   pnpm higgsfield:seedance
 *
 * Credentials are read from HF_CREDENTIALS ("key-id:key-secret"), loaded from `.env.local` — which
 * git ignores — or from the process environment. The value is checked for presence and shape only;
 * nothing here prints, logs or forwards it anywhere but the SDK.
 *
 * The result is reported for what it is. A completed request gives the video URL; a failed,
 * moderated or canceled one says so and exits non-zero. Nothing is ever called a success on hope.
 */
import { config as loadEnv } from "dotenv";
import { APIError, AuthenticationError, BadInputError, CredentialsMissedError, HiggsfieldError, NotEnoughCreditsError, TimeoutError, ValidationError, config, higgsfield } from "@higgsfield/client/v2";

loadEnv({ path: ".env.local", quiet: true });

const MODEL = "bytedance/seedance-2.5/text-to-video";

/** The request exactly as the model's API reference documents it. */
const input = {
  prompt: "A cinematic scene at sunset",
  duration: 5,
  resolution: "720p",
  aspect_ratio: "16:9",
  output_format: "mp4",
  generate_audio: true,
};

/** Present and shaped like "id:secret". The value itself never leaves `process.env`. */
function credentialsLookRight(): boolean {
  const value = process.env.HF_CREDENTIALS?.trim() ?? "";
  const separator = value.indexOf(":");
  return separator > 0 && separator < value.length - 1;
}

async function main(): Promise<number> {
  if (!credentialsLookRight()) {
    console.error("HF_CREDENTIALS is missing or not in the form key-id:key-secret.");
    console.error("Add it to .env.local (git-ignored) on your machine — never in chat or in a commit — and run again.");
    return 2;
  }

  // Ten minutes of polling is generous for a five-second clip; past that, something is wrong and
  // the SDK's TimeoutError below says so rather than waiting for ever.
  config({ credentials: process.env.HF_CREDENTIALS, maxPollTime: 10 * 60 * 1000 });

  console.log(`Submitting to ${MODEL} (${input.duration}s, ${input.resolution}, ${input.aspect_ratio}, audio ${input.generate_audio ? "on" : "off"}) and waiting…`);
  const started = Date.now();
  const result = await higgsfield.subscribe(MODEL, { input, withPolling: true });
  const seconds = Math.round((Date.now() - started) / 1000);

  // The SDK types five statuses; the API also cancels. Widened so every outcome is named.
  const status: string = result.status;
  switch (status) {
    case "completed": {
      const url = result.video?.url;
      if (!url) {
        console.error(`Request ${result.request_id} completed after ${seconds}s but the response carries no video URL.`);
        return 1;
      }
      console.log(`Video ready after ${seconds}s:`);
      console.log(url);
      return 0;
    }
    case "failed":
      console.error(`Request ${result.request_id} failed after ${seconds}s. Status: ${result.status_url}`);
      return 1;
    case "nsfw":
      console.error(`Request ${result.request_id} was moderated: the prompt or the output was flagged, and no video was produced.`);
      return 1;
    case "canceled":
      console.error(`Request ${result.request_id} was canceled before it produced a video.`);
      return 1;
    default:
      console.error(`Request ${result.request_id} ended in status "${status}" after ${seconds}s without a video. Status: ${result.status_url}`);
      return 1;
  }
}

/** Every SDK error, named; none of them echo the credential. */
function explain(err: unknown): string {
  if (err instanceof CredentialsMissedError || err instanceof AuthenticationError) return `Higgsfield rejected the credentials: ${err.message}`;
  if (err instanceof NotEnoughCreditsError) return "The Higgsfield account has no credits left for this request.";
  if (err instanceof ValidationError || err instanceof BadInputError) {
    const details = err.details?.map((d) => `${d.loc.join(".")}: ${d.msg}`).join("; ");
    return `Higgsfield refused the input${details ? ` — ${details}` : `: ${err.message}`}`;
  }
  if (err instanceof TimeoutError) return `Gave up waiting: ${err.message}`;
  if (err instanceof APIError) return `Higgsfield API error${err.statusCode ? ` (HTTP ${err.statusCode})` : ""}: ${err.message}`;
  if (err instanceof HiggsfieldError) return `Higgsfield SDK error: ${err.message}`;
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    console.error(explain(err));
    process.exitCode = 1;
  });
