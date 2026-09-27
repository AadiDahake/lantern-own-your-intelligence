/**
 * Creates a console account and the one project it owns.
 *
 * Email confirmation is on for this Supabase project, so a plain client-side sign-up would leave
 * the user waiting for a mail that nobody sends. The admin API creates the user already confirmed
 * instead, and the browser signs in with the password straight afterwards.
 */
import { NextResponse } from "next/server";
import { createProject } from "@/lib/console/provision";
import { supabaseServiceRoleKey, supabaseUrl } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { email?: unknown; password?: unknown; company?: unknown };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Undoes the user creation when the project could not follow, so a retry is not blocked. */
async function deleteUser(id: string): Promise<void> {
  await fetch(`${supabaseUrl()}/auth/v1/admin/users/${id}`, {
    method: "DELETE",
    headers: {
      apikey: supabaseServiceRoleKey(),
      authorization: `Bearer ${supabaseServiceRoleKey()}`,
    },
  }).catch(() => undefined);
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as Body;
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const company = typeof body.company === "string" ? body.company.trim() : "";

  if (!EMAIL_PATTERN.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Use a password of at least 8 characters." }, { status: 400 });
  }
  if (company.length < 2) {
    return NextResponse.json({ error: "Enter your company name." }, { status: 400 });
  }

  const response = await fetch(`${supabaseUrl()}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: supabaseServiceRoleKey(),
      authorization: `Bearer ${supabaseServiceRoleKey()}`,
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { company },
    }),
  });

  if (!response.ok) {
    const detail = (await response.json().catch(() => ({}))) as { msg?: string; message?: string };
    const message = detail.msg ?? detail.message ?? "The account could not be created.";
    // 422 is what Supabase answers for an address that already has an account.
    return NextResponse.json({ error: message }, { status: response.status === 422 ? 409 : 502 });
  }

  const created = (await response.json().catch(() => ({}))) as { id?: string };
  if (!created.id) {
    return NextResponse.json({ error: "The account could not be created." }, { status: 502 });
  }

  try {
    // An empty workspace: its own slug and embed key, no site and no repository yet.
    await createProject(created.id, company);
  } catch (error) {
    await deleteUser(created.id);
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
