import { replyBytes } from "./pid-decoder";

const LETTERS = ["P", "C", "B", "U"] as const;

export function dtcFromBytes(b0: number, b1: number): string {
  const letter = LETTERS[b0 >> 6];
  const digit = (b0 >> 4) & 0x3;
  return `${letter}${digit}${(b0 & 0xf).toString(16).toUpperCase()}${b1
    .toString(16)
    .toUpperCase()
    .padStart(2, "0")}`;
}

/**
 * Decode a Mode 03 (stored) or 07 (pending) reply. `lines` are cleaned reply lines.
 * Over CAN the reply carries a DTC-count byte after the mode byte; older protocols do not.
 * On non-CAN buses the ECU pads with 00 00, which is skipped.
 */
export function parseDtcReply(lines: string[], mode: 0x43 | 0x47 | 0x4a, canFramed: boolean): string[] {
  const dtcs: string[] = [];
  // Multi-frame replies ("0: ..", "1: ..") are one message split over lines: join them.
  const framed = lines.filter((l) => /^[0-9A-F]:/.test(l));
  const messages = [...lines.filter((l) => !/^[0-9A-F]:/.test(l)).map((l) => [l]), framed];
  for (const msg of messages) {
    const bytes = replyBytes(msg);
    if (bytes[0] !== mode) continue;
    const data = bytes.slice(canFramed ? 2 : 1);
    for (let i = 0; i + 1 < data.length; i += 2) {
      if (data[i] === 0 && data[i + 1] === 0) continue;
      dtcs.push(dtcFromBytes(data[i], data[i + 1]));
    }
  }
  return [...new Set(dtcs)];
}
