import { strict as assert } from "node:assert";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { gapTurn, portalIdentity, sign } from "./gap-room.mjs";

test("sign matches the QM source authentication scheme", () => {
  const headers = sign("secret", "POST", "/v1/turns?async=1", "{}", 1_700_000_000);
  const expected = createHmac("sha256", "secret").update("v0:1700000000:POST\n/v1/turns?async=1\n{}").digest("hex");
  assert.deepEqual(headers, { "x-timestamp": "1700000000", "x-signature": `v0=${expected}` });
});

test("a gap becomes one thread in the room's group scope", () => {
  const turn = gapTurn("admin@lantern.local", "p1", { gap: { id: "g1" }, text: "Lantern gap g1" });
  assert.equal(turn.surface, "lantern");
  assert.deepEqual(turn.conversation, {
    kind: "group",
    channelRef: "web-project-p1",
    channelName: "Lantern gaps",
    threadRef: "lantern:gap:g1",
  });
  assert.equal(turn.deliveryTarget, "lantern:gap:g1");
  assert.match(turn.text, /^Lantern gap g1\n\nUse the lantern-gap-room skill/);
});

test("portalIdentity is the legacy signed payload core verifies", () => {
  const token = portalIdentity("portal-secret", "admin@lantern.local", 1_000);
  const [payload, signature] = token.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")), {
    p: "admin@lantern.local",
    exp: 61_000,
  });
  assert.equal(signature, createHmac("sha256", "portal-secret").update(payload).digest("base64url"));
});
