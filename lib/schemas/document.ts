import { z } from "zod";

/**
 * Fields read from a photographed RC or insurance policy. Every field is nullable: the model returns
 * null for anything it can't read clearly rather than guessing. Owner names and addresses are not
 * extracted; the inspection doesn't need them.
 */

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
const text = (max: number) => z.string().trim().min(1).max(max).nullable();

export const RcFields = z.object({
  regNo: text(16),
  make: text(40),
  model: text(40),
  variant: text(40),
  colour: text(30),
  fuel: z.enum(["Petrol", "Diesel", "CNG", "EV", "Hybrid"]).nullable(),
  /** MM/YYYY */
  mfgMonthYear: z.string().regex(/^(0[1-9]|1[0-2])\/\d{4}$/).nullable(),
  registrationDate: date,
  seatingCapacity: z.number().int().min(1).max(60).nullable(),
  /** Owner serial number: 1 for the first owner. */
  ownerSerial: z.number().int().min(1).max(20).nullable(),
  /** "active" when a bank or financier is named under hypothecation and not marked terminated. */
  hypothecation: z.enum(["none", "active"]).nullable(),
  chassisNumber: text(25),
  engineNumber: text(25),
  rto: text(60),
});
export type RcFields = z.infer<typeof RcFields>;

export const InsuranceFields = z.object({
  regNo: text(16),
  insurer: text(80),
  policyType: z.enum(["Comprehensive", "Third-party"]).nullable(),
  /** Last day of cover. */
  expiry: date,
  zeroDepreciation: z.boolean().nullable(),
});
export type InsuranceFields = z.infer<typeof InsuranceFields>;

export const DocumentKind = z.enum(["rc", "insurance"]);
export type DocumentKind = z.infer<typeof DocumentKind>;

/** What the model returns. `readable` is false for blurred, cropped or wrong documents. */
export const RcScan = z.object({ readable: z.boolean(), problem: z.string().max(200).nullable(), fields: RcFields });
export const InsuranceScan = z.object({ readable: z.boolean(), problem: z.string().max(200).nullable(), fields: InsuranceFields });

export const documentJsonSchema = { rc: z.toJSONSchema(RcScan), insurance: z.toJSONSchema(InsuranceScan) };

export type DocumentScan =
  | { kind: "rc"; readable: boolean; problem: string | null; fields: RcFields }
  | { kind: "insurance"; readable: boolean; problem: string | null; fields: InsuranceFields };

/** Normalise "KA 01 AB 1234" and "ka-01-ab-1234" to "KA01AB1234". */
export const normaliseReg = (reg: string) => reg.replace(/[\s-]/g, "").toUpperCase();

/**
 * Validate raw model output. A field that fails its schema becomes null on its own, so one
 * misread doesn't lose the rest. Returns null if the envelope is unusable. Never throws.
 */
export function validateDocumentScan(kind: DocumentKind, raw: unknown): DocumentScan | null {
  const envelope = z
    .object({ readable: z.boolean(), problem: z.string().nullable().optional(), fields: z.record(z.string(), z.unknown()) })
    .safeParse(raw);
  if (!envelope.success) return null;
  const shape = kind === "rc" ? RcFields.shape : InsuranceFields.shape;
  const fields: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(shape)) {
    const parsed = (schema as z.ZodType).safeParse(envelope.data.fields[key] ?? null);
    fields[key] = parsed.success ? parsed.data : null;
  }
  if (typeof fields.regNo === "string") {
    const reg = normaliseReg(fields.regNo);
    fields.regNo = /^[A-Z0-9]{4,12}$/.test(reg) ? reg : null;
  }
  const problem = envelope.data.problem ? envelope.data.problem.slice(0, 200) : null;
  return { kind, readable: envelope.data.readable, problem, fields } as DocumentScan;
}
