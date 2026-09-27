import pg from "pg";

/**
 * Connects to the database named by DATABASE_URL, exiting with a clear message when it is unset.
 *
 * `sslmode` is stripped from the URL and TLS configured here instead: the pooler presents a chain
 * Node does not trust out of the box, and recent pg versions read `sslmode=require` as full
 * verification, which fails. These scripts are run by hand against a known host, so the connection
 * is encrypted without verifying the chain.
 */
export async function connect() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set. It is the Postgres session-mode pooler URL.");
    process.exit(1);
  }

  const url = new URL(databaseUrl);
  url.searchParams.delete("sslmode");

  const client = new pg.Client({
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  return client;
}
