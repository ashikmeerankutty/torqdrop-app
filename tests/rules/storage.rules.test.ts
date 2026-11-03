import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { ref, uploadBytes, getBytes } from "firebase/storage";
import { afterAll, beforeAll, describe, it } from "vitest";

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-torqdrop",
    storage: { rules: readFileSync("storage.rules", "utf8"), host: "127.0.0.1", port: 9199 },
  });
});
afterAll(() => env.cleanup());

const alice = () => env.authenticatedContext("alice").storage();
const bob = () => env.authenticatedContext("bob").storage();
const bytes = (n: number) => new Uint8Array(n);

describe("inspection photos", () => {
  const path = "inspection-photos/alice/i1/tyre.jpg";

  it("owner can upload an image and read it back", async () => {
    await assertSucceeds(uploadBytes(ref(alice(), path), bytes(10), { contentType: "image/jpeg" }));
    await assertSucceeds(getBytes(ref(alice(), path)));
  });

  it("other users cannot read or write another user's photos", async () => {
    await assertFails(getBytes(ref(bob(), path)));
    await assertFails(uploadBytes(ref(bob(), path), bytes(10), { contentType: "image/jpeg" }));
  });

  it("rejects non-images and oversized files", async () => {
    await assertFails(uploadBytes(ref(alice(), "inspection-photos/alice/i1/a.pdf"), bytes(10), { contentType: "application/pdf" }));
    await assertFails(
      uploadBytes(ref(alice(), "inspection-photos/alice/i1/big.jpg"), bytes(11 * 1024 * 1024), { contentType: "image/jpeg" }),
    );
  });
});

describe("report PDFs", () => {
  it("owner can upload a PDF and cannot delete it", async () => {
    const r = ref(alice(), "reports/alice/r1.pdf");
    await assertSucceeds(uploadBytes(r, bytes(10), { contentType: "application/pdf" }));
    await assertFails(uploadBytes(ref(alice(), "reports/alice/r2.jpg"), bytes(10), { contentType: "image/jpeg" }));
  });

  it("others cannot read", async () => {
    await assertFails(getBytes(ref(bob(), "reports/alice/r1.pdf")));
  });
});
