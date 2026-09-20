import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createLogger } from "@/server/logger";

const run = promisify(execFile);
const log = createLogger("design:blueprint");

/**
 * The command-line tools that read a PDF, when the machine has them.
 *
 * Poppler (`pdfinfo`, `pdftohtml`, `pdftoppm`) reads a PDF better than anything available as a
 * library here: it names the page size in points, the fonts that were embedded, the size of every
 * run of type and the colour it was set in. That is measurement, and it is the difference between
 * "this title uses a 28pt serif for its headlines" and a guess dressed up as one.
 *
 * It is also not guaranteed to exist. A deployment without poppler still reads the file — page
 * geometry from `pdf-lib`, the rest from looking at the pages — and says in its notes which of the
 * two happened, because a reading that quietly got worse is worse than one that admits it.
 */
export async function tool(name: string, args: string[], options: { cwd?: string; timeoutMs?: number; maxBuffer?: number } = {}): Promise<string | null> {
  try {
    const { stdout } = await run(name, args, {
      cwd: options.cwd,
      timeout: options.timeoutMs ?? 30_000,
      maxBuffer: options.maxBuffer ?? 32 * 1024 * 1024,
      encoding: "utf8",
    });
    return stdout;
  } catch (err) {
    log.debug("tool unavailable or failed", { name, err: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/** A directory that cleans itself up, because a reader that leaks temp files is a disk that fills. */
export async function inScratch<T>(bytes: Buffer, fileName: string, fn: (filePath: string, dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "briefly-blueprint-"));
  // The name is ours, never the one the upload carried: a file called "../../etc/passwd" is a file
  // somebody chose the name of.
  const safe = `source${path.extname(fileName).slice(0, 8).replace(/[^a-zA-Z0-9.]/g, "") || ".bin"}`;
  const filePath = path.join(dir, safe);
  await writeFile(filePath, bytes);
  try {
    return await fn(filePath, dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Every file a tool left in the directory, in name order, as buffers. */
export async function harvest(dir: string, match: RegExp, limit: number): Promise<Buffer[]> {
  const names = (await readdir(dir).catch(() => [])).filter((name) => match.test(name)).sort();
  const out: Buffer[] = [];
  for (const name of names.slice(0, limit)) out.push(await readFile(path.join(dir, name)));
  return out;
}
