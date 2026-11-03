import { describe, expect, it } from "vitest";
import { isEmailSignInUrl, toE164India } from "../lib/auth/links";

const ACTION =
  "https://torqdrop-connect.firebaseapp.com/__/auth/action?apiKey=k&mode=signIn&oobCode=abc&continueUrl=x";

describe("isEmailSignInUrl", () => {
  it("accepts the bare action link", () => {
    expect(isEmailSignInUrl(ACTION)).toBe(true);
  });

  it("accepts the Hosting wrapper link", () => {
    const wrapped = `https://torqdrop-connect.firebaseapp.com/__/auth/links?link=${encodeURIComponent(ACTION)}`;
    expect(isEmailSignInUrl(wrapped)).toBe(true);
  });

  it("rejects other auth actions and app paths", () => {
    expect(isEmailSignInUrl(ACTION.replace("mode=signIn", "mode=resetPassword"))).toBe(false);
    expect(isEmailSignInUrl("torqdrop://inspections/1")).toBe(false);
    expect(isEmailSignInUrl("/inspections/1")).toBe(false);
  });
});

describe("toE164India", () => {
  it.each(["9876543210", "+91 98765 43210", "91-9876543210", "09876543210"])("normalises %s", (n) => {
    expect(toE164India(n)).toBe("+919876543210");
  });

  it("rejects landlines, short numbers and other countries", () => {
    expect(toE164India("4423456789")).toBeNull();
    expect(toE164India("98765")).toBeNull();
    expect(toE164India("+1 415 555 0100")).toBeNull();
  });
});
