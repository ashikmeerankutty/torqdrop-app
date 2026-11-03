import { type DocumentKind, type DocumentScan, documentJsonSchema, validateDocumentScan } from "../../lib/schemas/document";
import type { MetaClient, Usage } from "./shared/meta-client";

const COMMON = `Rules:
- Copy values exactly as printed. If a field is missing, cut off, blurred or you are not sure, return null for it. Never guess.
- Do not return owner names, addresses, phone numbers or any field not in the schema.
- Dates as YYYY-MM-DD. Indian documents print dates as DD/MM/YYYY or DD-MMM-YYYY; convert them.
- If the photo is not this kind of document, or is unreadable, set readable to false, explain briefly in problem, and return null fields.`;

export const DOCUMENT_PROMPTS: Record<DocumentKind, string> = {
  rc: `You read an Indian vehicle Registration Certificate (RC smart card, RC book or a printout from Parivahan/mParivahan).
Extract: registration number; maker (make) and model; variant if printed; colour; fuel type mapped to Petrol, Diesel, CNG (including "Petrol/CNG"), EV (electric/battery) or Hybrid; month and year of manufacture as MM/YYYY; date of registration; seating capacity; owner serial number (1 for first owner); hypothecation ("active" if a bank or financier is named and not marked terminated or cancelled, "none" if the field is empty, "NA" or terminated); chassis number; engine number; registering authority (RTO).
${COMMON}`,
  insurance: `You read an Indian motor insurance policy or certificate of insurance.
Extract: registration number of the insured vehicle; insurer company name; policy type ("Comprehensive" for package or own-damage plus third-party cover, "Third-party" for liability only); the last date of cover (policy end date, or own-damage end date for a comprehensive policy); whether a zero-depreciation (nil depreciation, bumper-to-bumper) add-on is included.
${COMMON}`,
};

export type ScanResult = { status: "ok"; scan: DocumentScan; usage: Usage[] } | { status: "ai_unavailable"; usage: Usage[] };

/** Read one document photo. Schema-validated field by field; retried once; never raw text. */
export async function readDocument(kind: DocumentKind, image: Buffer, client: MetaClient): Promise<ScanResult> {
  const usage: Usage[] = [];
  const url = `data:image/jpeg;base64,${image.toString("base64")}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { json, usage: u } = await client.completeJson({
      system: DOCUMENT_PROMPTS[kind],
      user: [
        { type: "text", text: `Read this ${kind === "rc" ? "registration certificate" : "insurance policy"}.` },
        { type: "image_url", image_url: { url } },
      ],
      schemaName: `${kind}_scan`,
      schema: documentJsonSchema[kind],
    });
    usage.push(u);
    const scan = validateDocumentScan(kind, json);
    if (scan) return { status: "ok", scan, usage };
  }
  return { status: "ai_unavailable", usage };
}
