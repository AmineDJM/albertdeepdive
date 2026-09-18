import { getStorage } from "@/server/storage";
import { createLogger } from "@/server/logger";

const log = createLogger("storage");

/**
 * Remove stored files once their rows are gone.
 *
 * Best effort by design: a bucket that cannot be reached must not undo a delete that already
 * succeeded in the database, because the rows are gone either way and a leaked file is a smaller
 * problem than a record that reappears. Logged, so a leak is a known leak rather than an invisible
 * one.
 */
export async function forgetFiles(keys: Iterable<string>): Promise<number> {
  const storage = getStorage();
  const unique = [...new Set([...keys].filter(Boolean))];
  await Promise.all(
    unique.map((key) =>
      storage.delete(key).catch((error: unknown) => {
        log.warn("could not remove a stored file", { key, error: error instanceof Error ? error.message : String(error) });
      }),
    ),
  );
  return unique.length;
}
