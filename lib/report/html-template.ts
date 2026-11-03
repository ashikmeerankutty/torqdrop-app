import type { Checklist, ItemRecord, ItemStatus } from "../diagnostics/checklists/types";
import { describeDtc } from "../diagnostics/dtc-database";
import { type EcuExtended, formatValue, type InspectionSummaryReport, type Verdict } from "../diagnostics/evidence-engine";

/**
 * The inspection report as a self-contained HTML page, in the order of the familiar Indian PPI report:
 * vehicle header, summary, one table per section, not-inspected list, sign-off, disclaimer.
 * Pure: the caller supplies data and a URL for each photo. Every piece of user text is escaped.
 */

export interface ReportFinding {
  id: string;
  sectionKey: string;
  itemKey: string;
  observedCondition: string;
  severity: "info" | "monitor" | "attention" | "urgent";
  confidence?: string | null;
  aiInterpretation?: string | null;
  uncertainty?: string | null;
}

export interface ReportData {
  reportId: string;
  generatedAt: Date | null;
  signOff: { name: string; at: Date | null };
  vehicle: {
    regNo: string;
    make: string;
    model: string;
    variant?: string | null;
    year?: number | null;
    fuel?: string | null;
    odometerKm?: number | null;
  };
  checklist: Checklist;
  sections: Record<string, { items?: Record<string, ItemRecord> } | undefined>;
  summary: InspectionSummaryReport;
  aiSummary: {
    overview: string;
    hypotheses: { statement: string; basis: string; confidence: string; evidenceRefs: string[]; nextStep: string }[];
  } | null;
  /** Inspector-confirmed findings only. */
  findings: ReportFinding[];
  /** Uploaded photos. */
  photos: { id: string; sectionKey: string; itemKey: string }[];
  ecuReadAt: Date | null;
  warnings: string[];
}

export const DISCLAIMER =
  "TorqDrop is an inspection assistant, not a mechanical guarantee. This report records what the inspector checked and saw on the date shown. Checks marked not inspected or not checked are unknowns, not passes. AI-written text is labelled and was reviewed against the checks; trouble codes name failed tests, not failed parts.";

const STATUS: Record<ItemStatus, { label: string; color: string }> = {
  good: { label: "Good", color: "#2e7d32" },
  acceptable: { label: "OK", color: "#558b2f" },
  attention: { label: "Attention", color: "#ef6c00" },
  defect: { label: "Defect", color: "#c62828" },
  not_applicable: { label: "N/A", color: "#757575" },
  not_inspected: { label: "Not inspected", color: "#8d6e63" },
};

const VERDICT: Record<Verdict, { title: string; color: string }> = {
  no_major_issues: { title: "No major issues found", color: "#2e7d32" },
  issues_found: { title: "Issues found", color: "#ef6c00" },
  serious_issues: { title: "Serious issues found", color: "#c62828" },
};

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const e = escapeHtml;

/** Dates in India time, whatever the server's zone. */
export function formatDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
}

const chip = (status: ItemStatus) => `<span class="chip" style="background:${STATUS[status].color}">${STATUS[status].label}</span>`;

export function renderReportHtml(data: ReportData, opts: { photoUrl: (id: string) => string; nonce?: string }): string {
  const { vehicle: v, summary } = data;
  const verdict = VERDICT[summary.verdict];
  const photosByItem = groupKeys(data.photos);
  const findingsByItem = groupKeys(data.findings);
  const title = `${v.make} ${v.model}${v.variant ? ` ${v.variant}` : ""}`;
  const photoStrip = (key: string) => {
    const photos = photosByItem.get(key) ?? [];
    if (!photos.length) return "";
    return `<div class="photos">${photos
      .map((p) => `<a href="${e(opts.photoUrl(p.id))}"><img src="${e(opts.photoUrl(p.id))}" alt="Photo evidence" loading="lazy"></a>`)
      .join("")}</div>`;
  };
  const findingBlock = (key: string) =>
    (findingsByItem.get(key) ?? [])
      .map(
        (f) => `<div class="finding">
  <div><strong>Confirmed finding (${e(f.severity)}):</strong> ${e(f.observedCondition)}</div>
  ${f.aiInterpretation ? `<div>${e(f.aiInterpretation)}</div>` : ""}
  ${f.uncertainty ? `<div class="muted">Uncertainty: ${e(f.uncertainty)}${f.confidence ? ` · ${e(f.confidence)} confidence` : ""}</div>` : ""}
</div>`,
      )
      .join("");

  const facts = [
    ["Registration", v.regNo],
    ["Make / model", title],
    ["Year", v.year ?? "—"],
    ["Fuel", v.fuel ?? "—"],
    ["Odometer", v.odometerKm != null ? `${v.odometerKm.toLocaleString("en-IN")} km` : "—"],
    ["Inspected", formatDate(data.signOff.at)],
  ];

  const flagged = summary.flagged.length
    ? summary.flagged
        .map((f) => {
          const key = `${f.sectionKey}/${f.itemKey}`;
          return `<div class="flag">
  <div class="row"><span>${chip(f.status)}</span><strong>${e(f.label)}</strong><span class="muted">${e(f.sectionTitle)}</span></div>
  ${f.value ? `<div>${e(f.value)}</div>` : ""}
  ${f.remarks ? `<div class="remark">“${e(f.remarks)}”</div>` : ""}
  ${findingBlock(key)}
  ${photoStrip(key)}
</div>`;
        })
        .join("")
    : `<p>No checks were rated as needing attention.</p>`;

  const ecu = summary.ecu;
  const ecuBlock = ecu
    ? `<section><h2>ECU scan${ecu.simulated ? ' <span class="chip" style="background:#8E44AD">SIMULATED DATA</span>' : ""}</h2>
  <p class="muted">Read ${e(formatDate(data.ecuReadAt))}. Check-engine light: ${ecu.milOn == null ? "unknown" : ecu.milOn ? "<strong>on</strong>" : "off"}.</p>
  ${
    ecu.stored.length || ecu.pending.length
      ? `<table>${[...ecu.stored.map((c) => [c, "Stored"]), ...ecu.pending.map((c) => [c, "Pending"])]
          .map(([c, kind]) => `<tr><td class="code">${e(c)}</td><td>${e(describeDtc(c).title)}</td><td class="muted">${kind}</td></tr>`)
          .join("")}</table>`
      : "<p>No trouble codes stored.</p>"
  }
  ${ecu.extended ? ecuExtendedHtml(ecu.extended) : ""}
  <p class="muted">Standard OBD reads engine and emissions codes only. ABS and airbag faults need a manufacturer scan tool.</p>
</section>`
    : "";

  const ai = data.aiSummary
    ? `<div class="ai"><div class="label">AI-written summary · reviewed against the checks</div>
  <p>${e(data.aiSummary.overview)}</p>
  ${data.aiSummary.hypotheses
    .map(
      (h) => `<div class="hyp"><strong>${e(h.statement)}</strong><div>Next: ${e(h.nextStep)}</div>
  <div class="muted">${e(h.confidence)} confidence · possibility, not a diagnosis · based on ${e(h.evidenceRefs.join(", "))}</div></div>`,
    )
    .join("")}
</div>`
    : "";

  const sectionTables = data.checklist.sections
    .map((section) => {
      const items = data.sections[section.key]?.items ?? {};
      const rows = section.items
        .map((def) => {
          const r = items[def.key];
          const key = `${section.key}/${def.key}`;
          const value = r ? formatValue(def, r) : null;
          const note = r?.status === "not_inspected" ? r.notInspectedReason : r?.remarks;
          return `<tr>
  <td>${e(def.label)}${def.critical ? ' <span class="crit">critical</span>' : ""}</td>
  <td>${r ? chip(r.status) : '<span class="chip" style="background:#9e9e9e">Not checked</span>'}</td>
  <td>${value ? e(value) : ""}${note ? `<div class="muted">${e(note)}</div>` : ""}${photoStrip(key)}</td>
</tr>`;
        })
        .join("");
      return `<section class="table-section"><h3>${e(section.title)}</h3><table><thead><tr><th>Check</th><th>Status</th><th>Details</th></tr></thead><tbody>${rows}</tbody></table></section>`;
    })
    .join("");

  const notInspected = summary.notInspected.length
    ? `<section><h2>Not inspected</h2><table>${summary.notInspected
        .map((n) => `<tr><td>${e(n.label)}</td><td class="muted">${e(n.sectionTitle)}</td><td>${e(n.reason ?? "No reason given")}</td></tr>`)
        .join("")}</table></section>`
    : "";

  const nonce = opts.nonce ? ` nonce="${e(opts.nonce)}"` : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${e(title)} · ${e(v.regNo)} · TorqDrop inspection report</title>
<style${nonce}>
  :root { --text:#111; --muted:#5a6270; --border:#e1e4e8; --accent:#FF6A1A; }
  * { box-sizing: border-box; }
  body { margin:0; font: 15px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: var(--text); background:#f3f4f6; }
  main { max-width: 860px; margin: 0 auto; background:#fff; padding: 24px 16px 40px; }
  header { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; border-bottom: 3px solid var(--accent); padding-bottom: 12px; }
  .brand { font-weight: 800; font-size: 20px; } .brand span { color: var(--accent); }
  h1 { font-size: 24px; margin: 16px 0 4px; } h2 { font-size: 18px; margin: 28px 0 10px; } h3 { font-size: 16px; margin: 20px 0 8px; }
  .facts { display:grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px 16px; margin: 12px 0; }
  .facts div { font-size: 13px; color: var(--muted); } .facts strong { display:block; color: var(--text); font-size: 15px; }
  .plate { display:inline-block; border:2px solid #111; border-radius:4px; padding:1px 8px; font-weight:800; letter-spacing:1px; background:#fafaf5; }
  .verdict { border-left: 6px solid; padding: 12px 14px; border-radius: 8px; background:#f7f7f8; margin: 16px 0; }
  .verdict .title { font-size: 20px; font-weight: 800; }
  .counts { display:flex; gap: 18px; flex-wrap: wrap; margin-top: 6px; color: var(--muted); }
  .counts strong { color: var(--text); font-size: 18px; }
  .chip { display:inline-block; color:#fff; font-size:12px; font-weight:700; padding:2px 8px; border-radius:999px; white-space:nowrap; }
  .crit { font-size:11px; color:#c62828; font-weight:700; text-transform:uppercase; }
  .flag { border:1px solid var(--border); border-radius:10px; padding:10px 12px; margin:8px 0; }
  .row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
  .remark { font-style: italic; }
  .finding { background:#fff6ef; border-radius:8px; padding:8px 10px; margin-top:6px; font-size:14px; }
  .muted { color: var(--muted); font-size: 13px; }
  .photos { display:flex; flex-wrap:wrap; gap:6px; margin-top:6px; }
  .photos img { width:96px; height:96px; object-fit:cover; border-radius:6px; border:1px solid var(--border); }
  .ai { border:1px dashed var(--accent); border-radius:10px; padding:12px; margin: 12px 0; }
  .ai .label { font-size:12px; font-weight:700; color: var(--accent); text-transform: uppercase; letter-spacing: .5px; }
  .hyp { border-top:1px solid var(--border); padding-top:8px; margin-top:8px; }
  table { width:100%; border-collapse: collapse; }
  th, td { text-align:left; vertical-align:top; padding:8px 6px; border-bottom:1px solid var(--border); }
  th { font-size:12px; color: var(--muted); text-transform: uppercase; }
  td.code { font-weight:800; font-variant-numeric: tabular-nums; }
  .signoff { display:grid; grid-template-columns: 1fr 1fr; gap:16px; border:1px solid var(--border); border-radius:10px; padding:12px; }
  .disclaimer { font-size: 12px; color: var(--muted); border-top:1px solid var(--border); margin-top: 28px; padding-top: 12px; }
  .warnings li { color: var(--muted); font-size: 13px; }
  .print { background: var(--accent); color:#140A03; border:0; border-radius:8px; padding:10px 14px; font-weight:700; font-size:14px; cursor:pointer; }
  @media print {
    body { background:#fff; } main { padding:0; max-width:none; } .print { display:none; }
    .table-section, .flag { break-inside: avoid; } .photos img { width:72px; height:72px; }
  }
</style>
</head>
<body>
<main>
<header>
  <div><div class="brand">Torq<span>Drop</span></div><div class="muted">Pre-purchase inspection report</div></div>
  <button class="print" id="print">Save as PDF</button>
</header>

<h1>${e(title)}</h1>
<span class="plate">${e(v.regNo)}</span>
<div class="facts">${facts.map(([k, val]) => `<div>${e(k)}<strong>${e(val)}</strong></div>`).join("")}</div>

<div class="verdict" style="border-color:${verdict.color}">
  <div class="title" style="color:${verdict.color}">${verdict.title}</div>
  <div class="counts">
    <span><strong>${summary.counts.defect}</strong> defects</span>
    <span><strong>${summary.counts.attention}</strong> need attention</span>
    <span><strong>${summary.counts.notInspected}</strong> not inspected</span>
    <span><strong>${summary.counts.answered}</strong> of ${summary.counts.total} checks answered</span>
  </div>
</div>

${ai}

<section><h2>Summary of issues</h2>${flagged}</section>
${ecuBlock}
${
  data.warnings.length
    ? `<section><h2>Notes</h2><ul class="warnings">${data.warnings.map((w) => `<li>${e(w)}</li>`).join("")}</ul></section>`
    : ""
}

<h2>All checks</h2>
${sectionTables}
${notInspected}

<section><h2>Sign-off</h2>
<div class="signoff">
  <div><div class="muted">Inspected and signed off by</div><strong>${e(data.signOff.name)}</strong></div>
  <div><div class="muted">Signed off</div><strong>${e(formatDate(data.signOff.at))}</strong></div>
</div></section>

<p class="disclaimer">${e(DISCLAIMER)}<br>Report ${e(data.reportId)} · generated ${e(formatDate(data.generatedAt))}.</p>
</main>
<script${nonce}>document.getElementById("print").addEventListener("click", function () { window.print(); });</script>
</body>
</html>`;
}

function groupKeys<T extends { sectionKey: string; itemKey: string }>(list: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const x of list) {
    const key = `${x.sectionKey}/${x.itemKey}`;
    map.set(key, [...(map.get(key) ?? []), x]);
  }
  return map;
}

function ecuExtendedHtml(x: EcuExtended): string {
  const incomplete = x.monitors.filter((m) => !m.complete);
  const rows: [string, string][] = [];
  if (x.vin) rows.push(["VIN reported by the car", x.vin]);
  if (x.odometerKm != null) rows.push(["Odometer from the engine computer", `${Math.round(x.odometerKm).toLocaleString("en-IN")} km`]);
  if (x.distanceSinceClearKm != null) rows.push(["Distance since codes were cleared", `${Math.round(x.distanceSinceClearKm).toLocaleString("en-IN")} km`]);
  if (x.warmUpsSinceClear != null) rows.push(["Warm-ups since codes were cleared", String(x.warmUpsSinceClear)]);
  if (x.monitors.length) rows.push(["Emissions self-tests", incomplete.length ? `Not finished: ${incomplete.map((m) => m.name).join(", ")}` : "All complete"]);
  if (x.permanent.length) rows.push(["Permanent codes", x.permanent.join(", ")]);
  const table = rows.length ? `<table>${rows.map(([k, v]) => `<tr><td>${e(k)}</td><td>${e(v)}</td></tr>`).join("")}</table>` : "";
  const flags = x.flags.map((f) => `<p><strong>${e(f.title)}.</strong> ${e(f.body)}</p>`).join("");
  return table + flags;
}
