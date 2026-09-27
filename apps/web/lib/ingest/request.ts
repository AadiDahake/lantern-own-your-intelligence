/** Turning what arrives at the API into a source ingestion understands. */
import { fileSource, textSource, urlSource } from "./sources";
import { readOriginal } from "./storage";
import type { ParsedSource } from "./types";

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** The three shapes `POST /api/documents` accepts: a file, an address, or a written note. */
export async function sourceFromRequest(request: Request): Promise<ParsedSource> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("No file was attached.");
    return fileSource(file);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new Error("Send a file, a JSON body with a url, or a JSON body with a title and text.");
  }
  const fields = (body ?? {}) as Record<string, unknown>;

  if (asString(fields.url).trim() !== "") return urlSource(asString(fields.url));
  if (asString(fields.text).trim() !== "") {
    return textSource(asString(fields.title), asString(fields.text));
  }
  throw new Error("Send a file, a JSON body with a url, or a JSON body with a title and text.");
}

export type StoredDocument = {
  title: string;
  source_kind: string;
  source_ref: string | null;
  source_text: string | null;
  storage_path: string | null;
  mime: string | null;
};

/**
 * The source a stored document can be built from again.
 *
 * The stored original wins, because reading the file itself is the only way to reproduce what a
 * scan produced. Failing that, an address is fetched again and a note is taken as written. A
 * source with none of the three predates originals being kept and says so.
 */
export async function sourceFromDocument(row: StoredDocument): Promise<ParsedSource> {
  if (row.storage_path) {
    const blob = await readOriginal(row.storage_path);
    if (blob) {
      const filename = row.storage_path.split("/").pop() ?? row.title;
      const file = new File([blob], filename, { type: row.mime ?? blob.type });
      return { ...(await fileSource(file)), title: row.title };
    }
  }
  if (row.source_kind === "url" && row.source_ref) return urlSource(row.source_ref);
  if (row.source_text) {
    // The row keeps the kind it is known by; only its passages are rebuilt.
    const parsed = textSource(row.title, row.source_text);
    return { ...parsed, kind: row.source_kind as ParsedSource["kind"], sourceRef: row.source_ref, mime: row.mime };
  }
  throw new Error(
    "This source has no file, address or text to read again. Add the file to it and try once more.",
  );
}
