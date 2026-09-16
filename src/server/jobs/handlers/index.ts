/**
 * Registers every job handler. Imported lazily by the runner/worker so that
 * services can enqueue jobs without creating import cycles.
 */
import "@/server/campaigns/jobs";
import "@/server/editorial/jobs";
import "@/server/media/jobs";
import "@/server/publication/jobs";
import "@/server/email/jobs";
