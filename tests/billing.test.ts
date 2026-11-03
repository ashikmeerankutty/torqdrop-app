import { describe, expect, it } from "vitest";

import { accountTag, chargeForReport, checkPurchase } from "../functions/src/billing";
import { FREE_REPORTS, findPack, REPORT_PACKS, reportsLeft } from "../lib/billing/plans";

describe("report packs", () => {
  it("match the Play product IDs and prices", () => {
    expect(REPORT_PACKS.map((p) => [p.id, p.reports, p.price])).toEqual([
      ["report_1", 1, 199],
      ["report_5", 5, 799],
      ["report_20", 20, 2499],
    ]);
    expect(findPack("report_5")?.reports).toBe(5);
    expect(findPack("shop_starter")).toBeUndefined();
  });

  it("counts the free report until it is used", () => {
    expect(FREE_REPORTS).toBe(1);
    expect(reportsLeft({ balance: 0, freeUsed: 0 })).toBe(1);
    expect(reportsLeft({ balance: 5, freeUsed: 0 })).toBe(6);
    expect(reportsLeft({ balance: 5, freeUsed: 1 })).toBe(5);
    expect(reportsLeft({ balance: 0, freeUsed: 3 })).toBe(0);
  });
});

describe("chargeForReport", () => {
  it("uses the free report first, then paid ones, then refuses", () => {
    expect(chargeForReport({ balance: 2, freeUsed: 0 })).toEqual({ next: { balance: 2, freeUsed: 1 }, source: "free" });
    expect(chargeForReport({ balance: 2, freeUsed: 1 })).toEqual({ next: { balance: 1, freeUsed: 1 }, source: "paid" });
    expect(chargeForReport({ balance: 0, freeUsed: 1 })).toBeNull();
  });
});

describe("checkPurchase", () => {
  const mine = accountTag("alice");

  it("accepts a completed, unconsumed purchase made by this account", () => {
    expect(checkPurchase({ purchaseState: 0, consumptionState: 0, obfuscatedExternalAccountId: mine }, "alice")).toBe("ok");
    // Purchases from before the tag was sent carry none; the payment record still binds them.
    expect(checkPurchase({ purchaseState: 0, consumptionState: 0 }, "alice")).toBe("ok");
  });

  it("waits for pending payments and rejects cancelled ones", () => {
    expect(checkPurchase({ purchaseState: 2 }, "alice")).toBe("pending");
    expect(checkPurchase({ purchaseState: 1 }, "alice")).toBe("cancelled");
    expect(checkPurchase({}, "alice")).toBe("cancelled");
  });

  it("rejects another account's purchase and already-consumed tokens", () => {
    expect(checkPurchase({ purchaseState: 0, obfuscatedExternalAccountId: accountTag("bob") }, "alice")).toBe("wrong-account");
    expect(checkPurchase({ purchaseState: 0, consumptionState: 1, obfuscatedExternalAccountId: mine }, "alice")).toBe("consumed");
  });

  it("tags accounts with a SHA-256 hex digest, as the app sends it", () => {
    expect(accountTag("alice")).toMatch(/^[0-9a-f]{64}$/);
    expect(accountTag("alice")).not.toContain("alice");
  });
});
