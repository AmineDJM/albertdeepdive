import { inflateRawSync } from "node:zlib";

/**
 * A tiny read-only ZIP parser (stored + deflate entries, no ZIP64) used to verify DOCX output
 * without adding a dependency: a .docx is a ZIP whose `word/document.xml` must be well-formed XML.
 */

export type ZipEntry = { name: string; compressedSize: number; size: number; method: number; read: () => Buffer };

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

export function readZipEntries(buffer: Buffer): ZipEntry[] {
  const eocd = findEndOfCentralDirectory(buffer);
  if (eocd < 0) throw new Error("Not a ZIP archive (end of central directory not found)");
  const entryCount = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  let cursor = centralOffset;
  for (let i = 0; i < entryCount; i += 1) {
    if (buffer.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) throw new Error("Corrupt ZIP central directory");
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const size = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    entries.push({
      name,
      compressedSize,
      size,
      method,
      read: () => readLocalEntry(buffer, localOffset, method, compressedSize),
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export function readZipEntry(buffer: Buffer, name: string): Buffer | null {
  const entry = readZipEntries(buffer).find((e) => e.name === name);
  return entry ? entry.read() : null;
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const min = Math.max(0, buffer.length - 65_557);
  for (let i = buffer.length - 22; i >= min; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) return i;
  }
  return -1;
}

function readLocalEntry(buffer: Buffer, offset: number, method: number, compressedSize: number): Buffer {
  if (buffer.readUInt32LE(offset) !== LOCAL_SIGNATURE) throw new Error("Corrupt ZIP local header");
  const nameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const start = offset + 30 + nameLength + extraLength;
  const data = buffer.subarray(start, start + compressedSize);
  if (method === 0) return Buffer.from(data);
  if (method === 8) return inflateRawSync(data);
  throw new Error(`Unsupported ZIP compression method ${method}`);
}

/**
 * Lightweight XML well-formedness check: balanced tags, a single root element and no bare
 * ampersands. Enough to catch the classes of bugs a document generator can produce.
 */
export function checkXmlWellFormed(xml: string): { ok: boolean; error?: string } {
  const body = xml
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
  const badEntity = /&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.exec(body);
  if (badEntity) return { ok: false, error: `Unescaped ampersand at offset ${badEntity.index}` };
  const stack: string[] = [];
  let roots = 0;
  const tag = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = tag.exec(body))) {
    const between = body.slice(cursor, m.index);
    if (between.includes("<")) return { ok: false, error: `Stray '<' before offset ${m.index}` };
    cursor = m.index + m[0].length;
    const [, closing, name, , selfClosing] = m;
    if (closing) {
      const open = stack.pop();
      if (open !== name) return { ok: false, error: `Mismatched closing tag </${name}> (expected </${open ?? "?"}>)` };
    } else if (!selfClosing) {
      if (stack.length === 0) roots += 1;
      stack.push(name);
    } else if (stack.length === 0) {
      roots += 1;
    }
  }
  if (body.slice(cursor).includes("<")) return { ok: false, error: "Stray '<' after last tag" };
  if (stack.length) return { ok: false, error: `Unclosed tag <${stack[stack.length - 1]}>` };
  if (roots !== 1) return { ok: false, error: `Expected exactly one root element, found ${roots}` };
  return { ok: true };
}
