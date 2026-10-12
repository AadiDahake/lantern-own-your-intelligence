/**
 * Prints a phone number sealed the way the app stores it, for the worker's test.
 *
 * The worker opens the number of a person who asked for a text (`steps/sms_notice.py`), so it has
 * to read exactly what `lib/sms/phone.ts` writes. The fixture in
 * `services/worker/tests/test_seal.py` is generated here rather than written by hand. The key and
 * the number are throwaway values passed in on the command line; never run this with a real
 * service role key or a real person's number, because the output would go into the repository.
 *
 *   npx tsx --tsconfig apps/web/tsconfig.json apps/web/scripts/subscriber-phone-fixture.ts <fake-service-role-key> <fake-number>
 */
import { sealPhone } from "../lib/sms/phone";

const [key, plain] = process.argv.slice(2);

if (!key || !plain) {
  console.error("usage: subscriber-phone-fixture.ts <service-role-key> <number>");
  process.exit(2);
}

process.env.SUPABASE_SERVICE_ROLE_KEY = key;

console.log(JSON.stringify({ serviceRoleKey: key, plain, stored: sealPhone(plain) }, null, 2));
