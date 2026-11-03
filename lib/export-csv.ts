import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

const cell = (v: unknown) => {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(cell).join(",")).join("\n");
}

/** Write a CSV to the cache folder and open the share sheet. */
export async function shareCsv(name: string, header: string[], rows: unknown[][]) {
  const file = new File(Paths.cache, `${name.replace(/[^\w.-]+/g, "_")}.csv`);
  file.create({ overwrite: true });
  await file.write(toCsv(header, rows));
  if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing isn't available on this device.");
  await Sharing.shareAsync(file.uri, { mimeType: "text/csv", dialogTitle: name });
}
