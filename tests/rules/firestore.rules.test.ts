import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, increment, serverTimestamp, writeBatch } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-torqdrop",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 },
  });
});
afterAll(() => env.cleanup());
beforeEach(() => env.clearFirestore());

const alice = () => env.authenticatedContext("alice").firestore();
const bob = () => env.authenticatedContext("bob").firestore();
const anon = () => env.unauthenticatedContext().firestore();

/** Seed documents bypassing rules, as Cloud Functions (Admin SDK) would. */
async function seed(fn: (db: any) => Promise<void>) {
  await env.withSecurityRulesDisabled(async (ctx) => fn(ctx.firestore()));
}

const inspection = (over = {}) => ({ ownerUid: "alice", status: "draft", mode: "ppi", ...over });

describe("inspections", () => {
  it("owner can create a draft; others and anonymous cannot", async () => {
    await assertSucceeds(setDoc(doc(alice(), "inspections/i1"), inspection()));
    await assertFails(setDoc(doc(bob(), "inspections/i2"), inspection()));
    await assertFails(setDoc(doc(anon(), "inspections/i3"), inspection()));
  });

  it("a user cannot read another user's inspection", async () => {
    await seed((db) => setDoc(doc(db, "inspections/i1"), inspection()));
    await assertSucceeds(getDoc(doc(alice(), "inspections/i1")));
    await assertFails(getDoc(doc(bob(), "inspections/i1")));
    await assertFails(getDoc(doc(anon(), "inspections/i1")));
  });

  it("a client cannot create or update an inspection as complete", async () => {
    await assertFails(setDoc(doc(alice(), "inspections/i1"), inspection({ status: "complete" })));
    await seed((db) => setDoc(doc(db, "inspections/i2"), inspection({ status: "in_progress" })));
    await assertFails(updateDoc(doc(alice(), "inspections/i2"), { status: "complete" }));
    await assertSucceeds(updateDoc(doc(alice(), "inspections/i2"), { status: "blocked" }));
  });

  it("a complete inspection is locked, including deletion", async () => {
    await seed((db) => setDoc(doc(db, "inspections/i1"), inspection({ status: "complete" })));
    await assertFails(updateDoc(doc(alice(), "inspections/i1"), { mode: "driver_assist" }));
    await assertFails(deleteDoc(doc(alice(), "inspections/i1")));
  });

  it("clients cannot write the AI summary or sign-off, which only functions set", async () => {
    await seed((db) => setDoc(doc(db, "inspections/i1"), inspection()));
    const db = alice();
    for (const field of ["aiSummary", "signOff", "signedOffAt", "reportId", "verdict"]) {
      await assertFails(updateDoc(doc(db, "inspections/i1"), { [field]: "forged" }));
      await assertFails(setDoc(doc(db, `inspections/new-${field}`), inspection({ [field]: "forged" })));
    }
    await assertSucceeds(updateDoc(doc(db, "inspections/i1"), { mode: "ppi" }));
  });

  it("an inspection that already has an AI summary can still be edited", async () => {
    await seed((db) => setDoc(doc(db, "inspections/i1"), inspection({ aiSummary: { overview: "x" } })));
    await assertSucceeds(updateDoc(doc(alice(), "inspections/i1"), { "progress.answered": 3 }));
  });

  it("the owner cannot be reassigned", async () => {
    await seed((db) => setDoc(doc(db, "inspections/i1"), inspection()));
    await assertFails(updateDoc(doc(alice(), "inspections/i1"), { ownerUid: "bob" }));
  });
});

describe("inspection subcollections", () => {
  beforeEach(() => seed((db) => setDoc(doc(db, "inspections/i1"), inspection({ status: "in_progress" }))));

  it("owner can write sections, evidence and findings", async () => {
    for (const sub of ["sections", "evidence", "findings"]) {
      await assertSucceeds(setDoc(doc(alice(), `inspections/i1/${sub}/x`), { a: 1 }));
    }
  });

  it("other users can neither read nor write them", async () => {
    await seed((db) => setDoc(doc(db, "inspections/i1/findings/f1"), { a: 1 }));
    await assertFails(getDoc(doc(bob(), "inspections/i1/findings/f1")));
    await assertFails(setDoc(doc(bob(), "inspections/i1/findings/f2"), { a: 1 }));
  });

  it("unknown subcollections are denied", async () => {
    await assertFails(setDoc(doc(alice(), "inspections/i1/secrets/x"), { a: 1 }));
  });

  it("owner can create an inspection and its first section in one batch", async () => {
    const db = alice();
    const batch = writeBatch(db);
    batch.set(doc(db, "inspections/new1"), inspection());
    batch.set(doc(db, "inspections/new1/sections/vehicle_details"), { a: 1 });
    await assertSucceeds(batch.commit());
  });

  it("owner can save an answer with the inspection's progress counter, as saveItem does", async () => {
    await seed((db) => setDoc(doc(db, "inspections/i1"), inspection()));
    const db = alice();
    const batch = writeBatch(db);
    batch.set(doc(db, "inspections/i1/sections/engine"), { answered: 1, items: { leaks: { status: "good" } } }, { merge: true });
    batch.update(doc(db, "inspections/i1"), {
      updatedAt: serverTimestamp(),
      "progress.answered": increment(1),
      "progress.total": 200,
      status: "in_progress",
    });
    await assertSucceeds(batch.commit());
  });

  it("another user cannot sneak a child in by batching it with someone else's inspection", async () => {
    const db = bob();
    const batch = writeBatch(db);
    batch.update(doc(db, "inspections/i1"), { mode: "driver_assist" });
    batch.set(doc(db, "inspections/i1/sections/x"), { a: 1 });
    await assertFails(batch.commit());
  });

  it("children are locked once the inspection is complete", async () => {
    await seed((db) => setDoc(doc(db, "inspections/i1"), inspection({ status: "complete" })));
    await assertFails(setDoc(doc(alice(), "inspections/i1/findings/late"), { a: 1 }));
    await assertSucceeds(getDoc(doc(alice(), "inspections/i1/findings/late")));
  });
});

describe("org membership", () => {
  beforeEach(() =>
    seed(async (db) => {
      await setDoc(doc(db, "orgs/shop1/members/bob"), { role: "inspector" });
      await setDoc(doc(db, "inspections/i1"), inspection({ orgId: "shop1", status: "in_progress" }));
    }),
  );

  it("org members can read and write children, non-members cannot", async () => {
    await assertSucceeds(getDoc(doc(bob(), "inspections/i1")));
    await assertSucceeds(setDoc(doc(bob(), "inspections/i1/evidence/e1"), { a: 1 }));
    const carol = env.authenticatedContext("carol").firestore();
    await assertFails(getDoc(doc(carol, "inspections/i1")));
  });

  it("members cannot edit the inspection document itself", async () => {
    await assertFails(updateDoc(doc(bob(), "inspections/i1"), { mode: "driver_assist" }));
  });

  it("clients cannot write memberships", async () => {
    await assertFails(setDoc(doc(alice(), "orgs/shop1/members/alice"), { role: "owner" }));
  });
});

describe("server-owned collections", () => {
  it("clients cannot write credits, subscriptions, payments, reports or usage", async () => {
    for (const path of [
      "creditLedger/c1",
      "subscriptions/s1",
      "payments/p1",
      "reports/r1",
      "aiUsage/u1",
      "plans/pro",
    ]) {
      await assertFails(setDoc(doc(alice(), path), { ownerUid: "alice", delta: 100 }));
    }
  });

  it("owner can read their own credit ledger but not someone else's", async () => {
    await seed((db) => setDoc(doc(db, "creditLedger/c1"), { ownerUid: "alice", delta: 1 }));
    await assertSucceeds(getDoc(doc(alice(), "creditLedger/c1")));
    await assertFails(getDoc(doc(bob(), "creditLedger/c1")));
  });

  it("AI quota counters and report share links are server-only, even for their owner", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "aiQuota/alice"), { day: "2026-10-28", counts: { explainDtc: 1 } });
      await setDoc(doc(db, "reportShares/abc"), { ownerUid: "alice", reportId: "r1" });
    });
    await assertFails(getDoc(doc(alice(), "aiQuota/alice")));
    await assertFails(setDoc(doc(alice(), "aiQuota/alice"), { day: "2026-10-28", counts: {} }));
    await assertFails(getDoc(doc(alice(), "reportShares/abc")));
    await assertFails(setDoc(doc(alice(), "reportShares/new"), { ownerUid: "alice", reportId: "r1" }));
  });

  it("the report balance is readable by its owner only and writable by no client", async () => {
    await seed((db) => setDoc(doc(db, "credits/alice"), { balance: 5, freeUsed: 1 }));
    await assertSucceeds(getDoc(doc(alice(), "credits/alice")));
    await assertFails(getDoc(doc(bob(), "credits/alice")));
    await assertFails(updateDoc(doc(alice(), "credits/alice"), { balance: 500 }));
    await assertFails(setDoc(doc(bob(), "credits/bob"), { balance: 500, freeUsed: 0 }));
    await assertFails(setDoc(doc(alice(), "creditLedger/x"), { ownerUid: "alice", delta: 500 }));
  });

  it("payments and aiUsage are not readable by clients", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "payments/p1"), { ownerUid: "alice" });
      await setDoc(doc(db, "aiUsage/u1"), { uid: "alice" });
    });
    await assertFails(getDoc(doc(alice(), "payments/p1")));
    await assertFails(getDoc(doc(alice(), "aiUsage/u1")));
  });
});

describe("vehicles and users", () => {
  it("owner manages their vehicles; others cannot read", async () => {
    await assertSucceeds(setDoc(doc(alice(), "vehicles/v1"), { ownerUid: "alice", make: "Maruti" }));
    await assertFails(getDoc(doc(bob(), "vehicles/v1")));
    await assertFails(setDoc(doc(bob(), "vehicles/v2"), { ownerUid: "alice" }));
  });

  it("a profile holds only a valid name and email", async () => {
    const db = alice();
    await assertSucceeds(setDoc(doc(db, "users/alice"), { fullName: "Alice Rao", email: "alice@example.com" }));
    await assertFails(setDoc(doc(db, "users/alice"), { fullName: "A", email: "alice@example.com" }));
    await assertFails(setDoc(doc(db, "users/alice"), { fullName: "Alice Rao", email: "not-an-email" }));
    await assertFails(setDoc(doc(db, "users/alice"), { fullName: "Alice Rao", email: "alice@example.com", role: "admin" }));
  });

  it("users can only access their own profile", async () => {
    await assertSucceeds(setDoc(doc(alice(), "users/alice"), { fullName: "Alice Rao", email: "alice@example.com" }));
    await assertFails(getDoc(doc(bob(), "users/alice")));
  });

  it("everything else is denied by default", async () => {
    await assertFails(setDoc(doc(alice(), "random/x"), { a: 1 }));
  });
});
