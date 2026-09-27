/**
 * Prints a GitHub token encrypted the way the app stores it, for the worker's decryption test.
 *
 * The Python side has to read exactly what the TypeScript side writes, so the fixture in
 * `services/worker/tests/test_github_token.py` is generated here rather than written by hand.
 * The key and the plaintext are throwaway values passed in on the command line; never run this
 * with a real service role key, because the output would go into the repository.
 *
 *   npx tsx apps/web/scripts/github-token-fixture.ts <fake-service-role-key> <fake-token>
 */
import { encryptToken } from "../lib/github/secret";

const [key, plain] = process.argv.slice(2);

if (!key || !plain) {
  console.error("usage: github-token-fixture.ts <service-role-key> <token>");
  process.exit(2);
}

process.env.SUPABASE_SERVICE_ROLE_KEY = key;

console.log(JSON.stringify({ serviceRoleKey: key, plain, stored: encryptToken(plain) }, null, 2));
