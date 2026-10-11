#!/usr/bin/env -S npx tsx
/**
 * The live check of the text message provider, through the same client the product uses.
 *
 *   npm run dial:live                          # read-only: the key works, and what the sender number can do
 *   npm run dial:live -- --send +14155550123   # sends one real text to that number
 *
 * With no `DIAL_API_KEY` it calls nothing and says that text messages are off. That is exit 0 for
 * the read-only check and exit 1 for `--send`, because the text that was asked for did not go.
 * Run it through your secret manager. It never prints the key, and of the recipient it prints
 * only the last two digits.
 */
import { isE164, smsText } from "@lantern/shared";
import { listNumbers, sendSms, type DialNumber } from "../apps/web/lib/dial";
import { smsApiUrl } from "../apps/web/lib/env";

const masked = (number: string): string => `the number that ends in ${number.slice(-2)}`;

/** Why a number can or cannot text a US phone, in one line. */
function describe(number: DialNumber): string {
  const parts = [number.number, number.country ?? "country unknown", number.capabilities.join("+") || "no capabilities"];
  parts.push(`setup ${number.setupStatus ?? "unknown"}`);
  // A US number that carries SMS must be registered (10DLC) before a US carrier delivers its texts.
  parts.push(number.tenDlcStatus ? `10DLC ${number.tenDlcStatus}` : "10DLC does not apply");
  return parts.join(", ");
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const sendIndex = args.indexOf("--send");
  const to = sendIndex === -1 ? null : (args[sendIndex + 1] ?? "");
  if (to !== null && !isE164(to)) {
    console.error("--send needs a phone number in E.164 form, for example +14155550123.");
    return 2;
  }

  const apiKey = process.env.DIAL_API_KEY;
  if (!apiKey) {
    console.log("Text messages: off (DIAL_API_KEY is not set). Nothing was called.");
    return to === null ? 0 : 1;
  }
  const apiUrl = smsApiUrl();
  const fromNumber = process.env.DIAL_FROM_NUMBER ?? "";

  const listed = await listNumbers({ apiKey, apiUrl });
  if (!listed.ok) {
    console.error(`The key did not list the account's numbers at ${apiUrl}: ${listed.reason}.`);
    return 1;
  }
  console.log(`The key works. The account has ${listed.numbers.length} number(s):`);
  for (const number of listed.numbers) console.log(`  ${describe(number)}`);

  if (!fromNumber) {
    console.log("DIAL_FROM_NUMBER is not set, so text messages are off. Set it to one of the numbers above.");
    return to === null ? 0 : 1;
  }
  const sender = listed.numbers.find((number) => number.number === fromNumber || number.id === fromNumber);
  console.log(
    sender
      ? `DIAL_FROM_NUMBER is a number of this account: ${describe(sender)}.`
      : "DIAL_FROM_NUMBER is not the E.164 form or the id of a number above. It can still be a nickname.",
  );
  if (sender?.tenDlcStatus && sender.tenDlcStatus !== "approved") {
    console.log("US carriers block texts from this number to US phones until its 10DLC registration is approved.");
  }
  if (to === null) {
    console.log("Nothing was sent. Add --send <number> to send one real text.");
    return 0;
  }

  const body = smsText("Lantern live check: this is a test text from the product's own client. No reply is needed.");
  const result = await sendSms({ apiKey, apiUrl, fromNumber }, { to, body });
  if (result.state === "sent") {
    console.log(`The provider took one text for ${masked(to)}. Message id: ${result.id ?? "not given"}.`);
    return 0;
  }
  console.error(
    result.state === "refused"
      ? `The provider refused the text to ${masked(to)} and sent nothing: ${result.reason}.`
      : `No confirmed answer for the text to ${masked(to)}: ${result.reason}. It may or may not arrive. Do not send it again.`,
  );
  return 1;
}

main().then(
  (code) => process.exit(code),
  (error: Error) => {
    console.error(error.message);
    process.exit(1);
  },
);
