import { describe, expect, it } from "vitest";
import { draftNoticeText, isE164, SMS, smsText, toE164 } from "../src/sms";
import vectors from "./fixtures/sms-text.json";

/** Each character one segment of a plain text can hold without the wider encoding. */
const BASIC = /^[A-Za-z0-9 \n!"#$%&'()*+,\-./:;<=>?@_]*$/;

describe("smsText", () => {
  it.each(vectors.fold)("folds $in", ({ in: input, out }) => {
    expect(smsText(input)).toBe(out);
  });

  it.each(vectors.cut)("cuts $in at $max", ({ in: input, max, out }) => {
    expect(smsText(input, max)).toBe(out);
    expect(smsText(input, max).length).toBeLessThanOrEqual(Math.max(0, max));
  });

  it("returns only characters of the basic alphabet, whatever comes in", () => {
    const hostile = "\u0000\u001f\u007f\u0080\u200b\u202e\ufeff\ud83d\udc68\u200d\ud83d\udc69\u200d\ud83d\udc67 ok \u00e9\u0301\u0489";
    expect(smsText(hostile)).toBe("ok e");
    for (const { in: input } of vectors.fold) expect(smsText(input)).toMatch(BASIC);
  });

  it("never returns more than the cap of the send call", () => {
    expect(smsText("word ".repeat(1000)).length).toBe(SMS.maxChars);
    expect(smsText("word ".repeat(1000)).endsWith("...")).toBe(true);
  });

  it("gives the same text when it runs on its own result", () => {
    for (const { out } of vectors.fold) expect(smsText(out)).toBe(out);
  });
});

describe("draftNoticeText", () => {
  it.each(vectors.notice)("writes the notice for $company", ({ company, title, out }) => {
    expect(draftNoticeText({ company, title })).toBe(out);
  });

  it("stays in the basic alphabet and inside two segments for a long title", () => {
    const text = draftNoticeText({ company: "A".repeat(200), title: "\u201cB\u201d ".repeat(200) });
    expect(text).toMatch(BASIC);
    // Two concatenated segments hold 153 characters each.
    expect(text.length).toBeLessThanOrEqual(306);
  });

  it("quotes nothing that a phone turns into a link or a number to call", () => {
    const hostile = [
      "go to https://evil.example/claim?id=7",
      "visit evil.example now",
      "mail help@evil.example",
      "call +1 (415) 555-0123",
      "call 415-555-0123 or 415 555 0123 or 4155550123",
      "text 5 5 5 0 1 2 3 4",
    ];
    for (const title of hostile) {
      const text = draftNoticeText({ company: title, title });
      const quoted = text.slice(0, text.indexOf(". A change for it"));
      expect(quoted).not.toMatch(/[./@]|:\S|\d(?:[ -]?\d){6,}|\d{5,}/);
    }
  });

  it("gives the same text for the same gap each time", () => {
    const input = { company: "NovaAir", title: "Seat a party together" };
    expect(draftNoticeText(input)).toBe(draftNoticeText(input));
  });

  it("does not say that the feature is live", () => {
    const text = draftNoticeText({ company: "NovaAir", title: "Seat a party together" }).toLowerCase();
    for (const claim of ["shipped", "is live", "available", "released", "you can now"]) expect(text).not.toContain(claim);
  });
});

describe("isE164", () => {
  it.each(vectors.e164.valid)("accepts %s", (value) => {
    expect(isE164(value)).toBe(true);
  });

  it.each(vectors.e164.invalid)("refuses %j", (value) => {
    expect(isE164(value)).toBe(false);
  });
});

describe("toE164", () => {
  it.each([
    ["+14155550123", "+14155550123"],
    ["  +1 415 555 0123  ", "+14155550123"],
    ["+1 (415) 555-0123", "+14155550123"],
    ["+1.415.555.0123", "+14155550123"],
    ["+44 20 7946 0958", "+442079460958"],
    ["+44 (0)20 7946 0958", "+442079460958"],
    ["+44 (0) 20 7946 0958", "+442079460958"],
    ["+44 ( 0 ) 20 7946 0958", "+442079460958"],
    ["+44(0)7700 900123", "+447700900123"],
    ["+39 06 1234 5678", "+390612345678"],
    ["+49\t30\n901820", "+4930901820"],
  ])("reads %j as %s", (typed, number) => {
    expect(toE164(typed)).toBe(number);
  });

  it.each([
    "",
    " ",
    "4155550123",
    "(415) 555-0123",
    "0044 20 7946 0958",
    "011 44 20 7946 0958",
    "+0 415 555 0123",
    "+1 415 55",
    "+1 415 555 0123 ext 4",
    "+1 415 555 0123 x4",
    "+1415555012345678",
    "++14155550123",
    "+1+4155550123",
    "tel:+14155550123",
    "+1 415 555 0123, +1 415 555 0124",
    "+1 415 555 O123",
    // A zero in brackets means "not dialled from abroad" only directly after the country code.
    "+1 415 555 (0)123",
    "+1 415 (0) 555 0123",
    "+44 (0)20 7946 (0)958",
    "(0)20 7946 0958",
  ])("refuses %j", (typed) => {
    expect(toE164(typed)).toBeNull();
  });

  it("gives back each number that is already in E.164 form", () => {
    for (const value of vectors.e164.valid) expect(toE164(value)).toBe(value);
  });

  it("never guesses a country code", () => {
    // Ten digits are a US number to one person and the start of a different number to the next.
    expect(toE164("415 555 0123")).toBeNull();
    expect(toE164("1 415 555 0123")).toBeNull();
  });

  it("refuses a value that is longer than a typed number", () => {
    expect(toE164(`+1415555${" ".repeat(40)}0123`)).toBeNull();
  });
});
