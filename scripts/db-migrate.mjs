#!/usr/bin/env node
/**
 * Applies every file in supabase/migrations in filename order and records what it applied.
 * Each file runs inside a transaction, so a failure leaves the schema untouched.
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connect } from "./lib/pg-client.mjs";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations");

const client = await connect();

try {
  await client.query(`
    create table if not exists schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const applied = new Set(
    (await client.query("select filename from schema_migrations")).rows.map((row) => row.filename),
  );

  const files = (await readdir(MIGRATIONS_DIR)).filter((name) => name.endsWith(".sql")).sort();

  let ran = 0;
  for (const filename of files) {
    if (applied.has(filename)) {
      console.log(`skip  ${filename}`);
      continue;
    }

    const sql = await readFile(join(MIGRATIONS_DIR, filename), "utf8");
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("insert into schema_migrations (filename) values ($1)", [filename]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      console.error(`failed ${filename}`);
      throw error;
    }
    console.log(`apply ${filename}`);
    ran += 1;
  }

  console.log(ran === 0 ? "already up to date" : `applied ${ran} migration(s)`);
} finally {
  await client.end();
}
