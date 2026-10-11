/**
 * The forge runner's heartbeat: one `status` trace row for each project every 60 seconds.
 *
 * The worker writes the same row for the `local` engine (`services/worker/heartbeat.py`), with
 * the same title and the same detail. Two readers use it. The console shows "Agent live" from the
 * newest `status` row. The web app offers the one text about a gap only when the runner that
 * sends it says `sms: true` here (`lib/sms/offer.ts`), because the forge runner has its own
 * environment and the web app cannot see it.
 *
 * `sms` is an argument: nothing in `lib/forge` reads the environment for it.
 */
import { serviceClient } from "../supabase";

/** How often the runner writes its heartbeat. */
export const HEARTBEAT_MS = 60_000;

/** The same title as the worker's heartbeat, so one query reads both. */
const TITLE = "worker online";

/** Writes one heartbeat for each project. Returns how many it wrote. */
export async function beatOnce(input: { sms: boolean }): Promise<number> {
  const db = serviceClient();
  const projects = await db.from("project").select("id");
  if (projects.error) throw new Error(projects.error.message);
  const rows = (projects.data ?? []).map((project) => ({
    project_id: String(project.id),
    source: "forge",
    kind: "status",
    status: "ok",
    title: TITLE,
    detail: { engine: "forge", at: new Date().toISOString(), sms: input.sms },
  }));
  if (rows.length === 0) return 0;
  const written = await db.from("trace_event").insert(rows);
  if (written.error) throw new Error(written.error.message);
  return rows.length;
}
