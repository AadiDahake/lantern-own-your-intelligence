/**
 * Keeping the original of every uploaded source.
 *
 * What the reader extracted is only ever an interpretation of a file. The console shows both,
 * side by side, so the file itself has to survive ingestion. It lives in a private bucket that
 * only the service role can read; the browser reaches it through `/api/documents/:id/file`.
 */
import { serviceClient } from "../supabase";

export const SOURCE_BUCKET = "sources";

/** Created once per server instance; Supabase answers "already exists" for every later call. */
let bucketReady: Promise<void> | null = null;

async function createBucket(): Promise<void> {
  const { error } = await serviceClient().storage.createBucket(SOURCE_BUCKET, { public: false });
  // The bucket is shared by every deployment, so "already exists" is the normal answer.
  if (error && !/exist/i.test(error.message)) {
    throw new Error(`The source bucket could not be created: ${error.message}`);
  }
}

export async function ensureSourceBucket(): Promise<void> {
  if (!bucketReady) {
    bucketReady = createBucket().catch((failure: unknown) => {
      // A failed attempt must not be cached, or the next upload inherits it forever.
      bucketReady = null;
      throw failure;
    });
  }
  return bucketReady;
}

/** Storage keys are path segments, so anything that is not one becomes a dash. */
function safeName(name: string): string {
  const cleaned = name.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned === "" ? "source" : cleaned.slice(-120);
}

export function objectKey(projectId: string, documentId: string, filename: string): string {
  return `${projectId}/${documentId}/${safeName(filename)}`;
}

/**
 * Stores the file a person uploaded and returns its object key.
 *
 * Losing the original is not worth losing a scan that took minutes, so the caller treats a
 * failure as "no original kept" rather than as a failed ingestion.
 */
export async function storeOriginal(
  projectId: string,
  documentId: string,
  file: File,
): Promise<string> {
  await ensureSourceBucket();
  const key = objectKey(projectId, documentId, file.name);
  const { error } = await serviceClient()
    .storage.from(SOURCE_BUCKET)
    .upload(key, await file.arrayBuffer(), {
      contentType: file.type || "application/octet-stream",
      upsert: true,
    });
  if (error) throw new Error(`The original file could not be stored: ${error.message}`);
  return key;
}

/** The stored bytes, or null when the object is gone. */
export async function readOriginal(key: string): Promise<Blob | null> {
  const { data, error } = await serviceClient().storage.from(SOURCE_BUCKET).download(key);
  if (error || !data) return null;
  return data;
}

/** Everything under one document's folder, so deleting a source takes its file with it. */
export async function removeOriginals(projectId: string, documentId: string): Promise<void> {
  const folder = `${projectId}/${documentId}`;
  const client = serviceClient();
  const { data } = await client.storage.from(SOURCE_BUCKET).list(folder);
  const keys = (data ?? []).map((entry) => `${folder}/${entry.name}`);
  if (keys.length > 0) await client.storage.from(SOURCE_BUCKET).remove(keys);
}
