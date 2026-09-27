#!/usr/bin/env node
/**
 * Creates the demo project the console ships with, and hands it to the demo account.
 *
 * Idempotent: the embed key is printed once, when the row is created, and never regenerated.
 * The owner is looked up by email through the auth admin API, because a Supabase auth user is not
 * reachable from a migration.
 */
import { randomBytes } from "node:crypto";
import { connect } from "./lib/pg-client.mjs";

const SLUG = process.env.LANTERN_PROJECT_SLUG ?? "novaair";
const OWNER_EMAIL = process.env.LANTERN_DEMO_OWNER_EMAIL ?? "dahakeaadi@gmail.com";

const PROJECT = {
  slug: SLUG,
  name: "NovaAir",
  company: "NovaAir",
  // Where the host app is deployed. Blank until it has an address, which leaves the console
  // asking for one rather than pointing the widget at a site that is not there.
  siteUrl: process.env.LANTERN_SITE_URL ?? null,
  repoFullName: process.env.LANTERN_REPO ?? null,
  repoDefaultBranch: "main",
  // Keep in step with DEFAULT_THRESHOLDS and DEFAULT_VOICE in @lantern/shared. The script
  // runs under plain node, so it repeats the values rather than importing TypeScript.
  settings: { docsThreshold: 0.62, interfaceThreshold: 0.5, voice: "marin" },
};

/** The auth user id behind an email address, or null when there is no such account. */
async function findAuthUserId(email) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  const query = new URL(`${url}/auth/v1/admin/users`);
  query.searchParams.set("per_page", "200");
  const response = await fetch(query, { headers: { apikey: key, authorization: `Bearer ${key}` } });
  if (!response.ok) return null;

  const body = await response.json();
  const wanted = email.trim().toLowerCase();
  const match = (body.users ?? []).find((user) => (user.email ?? "").toLowerCase() === wanted);
  return match ? match.id : null;
}

const client = await connect();

try {
  const existing = await client.query("select id, embed_key from project where slug = $1", [PROJECT.slug]);
  if (existing.rowCount > 0) {
    console.log("seed exists");
  } else {
    const embedKey = `pk_${randomBytes(12).toString("hex")}`;
    await client.query(
      `insert into project (slug, name, company, embed_key, site_url, repo_full_name, repo_default_branch, settings)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        PROJECT.slug,
        PROJECT.name,
        PROJECT.company,
        embedKey,
        PROJECT.siteUrl,
        PROJECT.repoFullName,
        PROJECT.repoDefaultBranch,
        JSON.stringify(PROJECT.settings),
      ],
    );
    console.log(`created project ${PROJECT.slug}`);
    console.log(`embed key: ${embedKey}`);
    console.log("Set this as NEXT_PUBLIC_LANTERN_KEY on the host app. It is not printed again.");
  }

  const ownerId = await findAuthUserId(OWNER_EMAIL);
  if (!ownerId) {
    console.log(`no account for ${OWNER_EMAIL} yet, so ${PROJECT.slug} stays unowned`);
  } else {
    const claimed = await client.query(
      "update project set owner_id = $1 where slug = $2 and owner_id is distinct from $1 returning id",
      [ownerId, PROJECT.slug],
    );
    console.log(
      claimed.rowCount > 0
        ? `${PROJECT.slug} now belongs to ${OWNER_EMAIL}`
        : `${PROJECT.slug} already belongs to ${OWNER_EMAIL}`,
    );
  }
} finally {
  await client.end();
}
