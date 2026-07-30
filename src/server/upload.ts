/**
 * What arrives on the socket, treated as hostile.
 *
 * Three jobs, in order: get the bytes off the wire without letting the sender
 * choose how much memory we spend, turn them into a file and a set of fields,
 * and — if the file is a zip — get its contents onto disk without letting an
 * entry name decide where "onto disk" is.
 *
 * Everything here is pure except `readBody`, which is why the zip half can be
 * tested against an actually malicious archive with no server running.
 */

import type { IncomingMessage } from "node:http";
import { posix, sep } from "node:path";
import { unzipSync } from "fflate";

/** 20 MB. A paper with its figures is a megabyte or two; ten times that is slack. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/**
 * Caps on the archive AFTER decompression, which is the number that matters:
 * deflate tops out near 1032:1, so the upload cap alone would allow a 20 MB zip
 * to become 20 GB. See `readZip` for why the declared sizes are trustworthy
 * enough to cap on.
 */
export interface ZipLimits {
  maxEntries: number;
  maxTotalBytes: number;
  maxEntryBytes: number;
}

export const ZIP_LIMITS: ZipLimits = {
  maxEntries: 500,
  maxTotalBytes: 200 * 1024 * 1024,
  maxEntryBytes: 64 * 1024 * 1024,
};

/** Extensions we will accept as the document itself. */
export const MARKDOWN_EXTS = [".md", ".markdown", ".txt"];

/**
 * An upload problem the sender can fix, as opposed to a bug. Carries the hint
 * separately so the API can render "what went wrong" and "what to do" apart.
 */
export class UploadError extends Error {
  readonly hint: string;
  readonly status: number;
  constructor(message: string, hint: string, status = 400) {
    super(message);
    this.name = "UploadError";
    this.hint = hint;
    this.status = status;
  }
}

/**
 * Read the whole request body, refusing past `limit`.
 *
 * `Response(...).formData()` needs the entire body in memory before it will
 * parse anything, so the cap has to be enforced HERE, chunk by chunk, rather
 * than after the fact: checking Content-Length is checking a number the sender
 * wrote.
 *
 * WHAT HAPPENS AFTER THE REFUSAL took two attempts. Destroying the socket the
 * instant the limit is crossed is the obvious move and it is wrong: the client
 * is still writing, so it never gets to read the 413 and sees a connection
 * reset instead — measured, as "SocketError: other side closed" against
 * `fetch`. A 413 nobody can read is not an error message.
 *
 * So: reject at once, which is what lets the handler write the 413, then keep
 * reading and discarding so the client can finish its write and read the reply.
 * The discard is not unbounded — past `GRACE` times the limit the sender is not
 * making a mistake, and the socket goes.
 */
const GRACE = 4;

export function readBody(req: IncomingMessage, limit = MAX_UPLOAD_BYTES): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let refused = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (refused) {
        if (size > limit * GRACE) req.destroy();
        return;
      }
      if (size > limit) {
        refused = true;
        chunks.length = 0; // let the partial upload go now, not at GC time
        reject(
          new UploadError(
            `Upload is larger than ${Math.round(limit / 1024 / 1024)} MB.`,
            "Send the markdown on its own, or a zip holding only the document and the figures it cites.",
            413,
          ),
        );
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!refused) resolve(Buffer.concat(chunks));
    });
    // A client that hangs up mid-upload is not an error worth a 500; the
    // rejection above has already been delivered when `refused` is set.
    req.on("error", (err) => {
      if (!refused) reject(err);
    });
  });
}

export interface Upload {
  /** The uploaded file's name as the browser reported it. Never used as a path. */
  filename: string;
  bytes: Uint8Array;
  /** Every non-file field, last one wins. */
  fields: Record<string, string>;
}

/**
 * multipart/form-data, with no dependency.
 *
 * `new Response(body, { headers }).formData()` is undici's parser, which ships
 * in Node — measured against a hand-built body with a filename containing a
 * space, a UTF-8 payload and two scalar fields, and it returns a real `File`
 * with the right bytes. It throws a bare TypeError on a malformed body, which
 * is not a sentence anyone can act on, so it is translated here.
 */
export async function parseMultipart(body: Buffer, contentType: string): Promise<Upload> {
  if (!/^multipart\/form-data\s*;/i.test(contentType)) {
    throw new UploadError(
      "This endpoint takes a multipart/form-data upload.",
      'Post a form with a "file" part holding the document, e.g. `curl -F file=@paper.md`.',
      415,
    );
  }
  let form: FormData;
  try {
    // A view over the same bytes rather than the Buffer itself: `BodyInit` is
    // the DOM's type here and names neither Node's Buffer nor a Uint8Array over
    // a SharedArrayBuffer. The cast narrows the backing store, it does not copy
    // — and copying would mean holding the upload twice at its size limit.
    const view = new Uint8Array(body.buffer as ArrayBuffer, body.byteOffset, body.byteLength);
    form = await new Response(view, { headers: { "content-type": contentType } }).formData();
  } catch {
    throw new UploadError(
      "The multipart body could not be parsed.",
      "Let your HTTP client set the Content-Type and boundary rather than writing them by hand.",
    );
  }

  const fields: Record<string, string> = {};
  let file: File | undefined;
  // `forEach`, not `for..of`: the project's tsconfig loads "DOM" without
  // "DOM.Iterable", so `FormData` is not iterable to the type checker here.
  form.forEach((value, key) => {
    if (typeof value === "string") {
      fields[key] = value;
      return;
    }
    // The named part wins; any other file part is ignored rather than guessed at.
    if (key === "file") file = value;
  });
  if (!file) {
    throw new UploadError(
      'The upload has no "file" part.',
      'Name the document part "file" — .md, .markdown, .txt, or a .zip containing one.',
    );
  }
  if (file.size === 0) {
    throw new UploadError(
      `"${file.name || "the uploaded file"}" is empty.`,
      "Check the path you gave your client; an empty part usually means the file was not found.",
    );
  }
  return {
    filename: file.name || "upload",
    bytes: new Uint8Array(await file.arrayBuffer()),
    fields,
  };
}

/** A zip starts "PK". Asked before unzipping so a PDF reads as a PDF. */
export function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

/**
 * ZIP SLIP. An entry name is attacker-controlled text, not a path, and the only
 * safe way to treat it is to rebuild the path from segments we have each
 * inspected. Returns the relative path to write, or `null` when the name cannot
 * be made safe.
 *
 * Rejected, each because it has been used to escape a directory somewhere:
 * absolute paths; a Windows drive letter or UNC prefix; any `..` segment,
 * including one hidden behind backslashes, which unzip implementations on
 * Windows treat as a separator and POSIX ones do not; and NUL, which truncates
 * the path in any C library the bytes later pass through.
 *
 * Note what is NOT a hole: a zip can carry a symlink, and a symlink pointing at
 * /etc is the other classic escape — but fflate reports entries as bytes and we
 * write them with `writeFile`, so a symlink entry lands as an ordinary file
 * containing its target's text. There is no code path here that calls `symlink`.
 */
export function safeEntryPath(name: string): string | null {
  if (name.includes("\0")) return null;
  // A backslash is a separator to enough unzip implementations that treating it
  // as an ordinary filename character is how `..\..\x` gets through.
  const segments = name.replace(/\\/g, "/").split("/");
  if (/^[a-zA-Z]:/.test(name) || name.startsWith("/") || name.startsWith("\\")) return null;

  const kept: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") return null;
    kept.push(segment);
  }
  if (kept.length === 0) return null;
  const path = kept.join("/");
  // A 4 KB filename is not a document, and some filesystems answer it with a
  // truncation rather than an error.
  if (path.length > 512 || kept.some((s) => s.length > 200)) return null;
  return path;
}

/** Belt and braces: the joined path must still be inside the root. */
export function insideRoot(root: string, joined: string): boolean {
  return joined === root || joined.startsWith(root.endsWith(sep) ? root : root + sep);
}

export interface ZipContents {
  /** Safe relative path (posix separators) → bytes. */
  files: Record<string, Uint8Array>;
  warnings: string[];
}

/**
 * Unzip within the limits, or refuse.
 *
 * Two passes over the central directory. The first decompresses nothing — a
 * filter returning false skips the inflate — and is where names and sizes are
 * judged; the second extracts only what the first approved. Splitting them
 * means a hostile entry is refused before any of the archive has been expanded,
 * and it keeps the decision out of a callback that runs inside library code.
 *
 * MEASURED, because the cap depends on it: fflate allocates exactly the
 * declared uncompressed size and truncates the inflate to it. An archive whose
 * header lies — patched to claim 10 bytes for a 5 MB member — yields 10 bytes
 * of memory and 10 bytes of garbage, not 5 MB. So capping on the declared sizes
 * is a real memory bound and not a promise the attacker gets to keep. The
 * post-hoc total below is there for the day that stops being true.
 */
export function readZip(bytes: Uint8Array, limits: ZipLimits = ZIP_LIMITS): ZipContents {
  const seen: { name: string; originalSize: number }[] = [];
  try {
    unzipSync(bytes, {
      filter: (f) => {
        seen.push({ name: f.name, originalSize: f.originalSize });
        return false;
      },
    });
  } catch {
    throw new UploadError(
      "That file starts like a zip but could not be read as one.",
      "Re-create the archive — a truncated download and a renamed .rar both look like this.",
    );
  }

  const warnings: string[] = [];
  const approved = new Map<string, string>(); // entry name → safe relative path
  let total = 0;
  for (const entry of seen) {
    if (entry.name.endsWith("/")) continue; // a directory entry carries no bytes
    if (isNoise(entry.name)) continue;

    const safe = safeEntryPath(entry.name);
    if (safe === null) {
      // Fail closed, and name the entry. Skipping it quietly would let an
      // archive that tried to write outside the job directory still produce a
      // deck, and nobody would ever learn it had tried.
      throw new UploadError(
        `The archive contains an entry that tries to escape its directory: "${entry.name}".`,
        "Re-zip from inside the folder so every path is relative and none of them start with / or contain ..",
      );
    }
    if (entry.originalSize > limits.maxEntryBytes) {
      throw new UploadError(
        `"${entry.name}" unpacks to ${mb(entry.originalSize)}, over the ${mb(limits.maxEntryBytes)} per-file limit.`,
        "Leave the large file out; a deck reads the document and its figures, not the dataset.",
      );
    }
    total += entry.originalSize;
    if (total > limits.maxTotalBytes) {
      throw new UploadError(
        `The archive unpacks to more than ${mb(limits.maxTotalBytes)}.`,
        "Send only the document and the figures it cites.",
      );
    }
    if (approved.size >= limits.maxEntries) {
      throw new UploadError(
        `The archive holds more than ${limits.maxEntries} files.`,
        "Send only the document and the figures it cites.",
      );
    }
    approved.set(entry.name, safe);
  }
  if (approved.size === 0) {
    throw new UploadError(
      "The archive is empty.",
      "Zip the folder that holds your markdown, not an empty one.",
    );
  }

  const raw = unzipSync(bytes, { filter: (f) => approved.has(f.name) });
  const files: Record<string, Uint8Array> = {};
  let actual = 0;
  for (const [name, safe] of approved) {
    const data = raw[name];
    if (!data) continue;
    actual += data.length;
    if (actual > limits.maxTotalBytes) {
      throw new UploadError(
        `The archive unpacks to more than ${mb(limits.maxTotalBytes)}.`,
        "Send only the document and the figures it cites.",
      );
    }
    if (files[safe]) warnings.push(`two entries both unpack to ${safe}; kept the last`);
    files[safe] = data;
  }
  return { files, warnings };
}

/**
 * Which file in the archive is the document.
 *
 * Shallowest wins, then a name that says so, then alphabetical — a paper's zip
 * is usually one markdown at the top and a folder of figures, and when it is
 * not, "the one nearest the root" is the guess a person would make.
 */
export function pickMarkdown(files: Record<string, Uint8Array>): string {
  const candidates = Object.keys(files).filter((p) =>
    MARKDOWN_EXTS.includes(posix.extname(p).toLowerCase()),
  );
  if (candidates.length === 0) {
    throw new UploadError(
      `The archive has no ${MARKDOWN_EXTS.join(", ")} file in it.`,
      "DeckSmith reads a markdown document. Add the .md next to your figures and zip the folder again.",
    );
  }
  const rank = (p: string) => {
    const base = posix.basename(p).toLowerCase();
    const named = /^(readme|index|main|paper|analysis)\./.test(base) ? 0 : 1;
    return [p.split("/").length, named, p] as const;
  };
  return candidates.sort((a, b) => {
    const [da, na, pa] = rank(a);
    const [db, nb, pb] = rank(b);
    return da - db || na - nb || pa.localeCompare(pb);
  })[0] as string;
}

/* ------------------------------------------------------------------ internals */

/** Archive litter that is neither the document nor a figure. */
function isNoise(name: string): boolean {
  return (
    name.startsWith("__MACOSX/") ||
    name.includes("/__MACOSX/") ||
    posix.basename(name) === ".DS_Store" ||
    posix.basename(name) === "Thumbs.db"
  );
}

function mb(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}
