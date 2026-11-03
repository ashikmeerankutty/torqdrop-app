/**
 * Reply function for MockTransport that behaves like a petrol car on CAN: the engine warms up,
 * idles, accelerates through the gears, cruises and slows down in a 90-second loop. It carries a lean
 * code, a pending misfire and a freeze frame so every Driver Assist feature has something to show.
 * All of it is labelled "Simulated" in the UI.
 */

const hex = (n: number) => (Math.round(n) & 0xff).toString(16).toUpperCase().padStart(2, "0");
const bytes = (...ns: number[]) => ns.map(hex).join(" ");
const word = (n: number) => [Math.floor(Math.round(n) / 256), Math.round(n) % 256];

/** Inverse of decodeSupportedPids: the 4-byte bitmap for PIDs base+1..base+32. */
export function supportedBitmap(base: number, pids: number[]): number[] {
  const out = [0, 0, 0, 0];
  for (const pid of pids) {
    const i = pid - base - 1;
    if (i >= 0 && i < 32) out[Math.floor(i / 8)] |= 0x80 >> i % 8;
  }
  return out;
}

const DTC_BYTES: Record<string, [number, number]> = { P0171: [0x01, 0x71], P0301: [0x03, 0x01] };

/** km/h per 1000 rpm in each gear, roughly a 1.2 L hatchback. */
const GEAR_RATIO = [0, 8.3, 14.3, 20.8, 27, 33];

const VIN = "MA3EWDE1SS0123456";

/** Multi-frame CAN reply as an ELM327 prints it: byte count, then "0:", "1:" … lines of 6/7 bytes. */
function multiFrame(data: number[]): string {
  const lines = [data.length.toString(16).toUpperCase().padStart(3, "0")];
  lines.push(`0: ${bytes(...data.slice(0, 6))}`);
  for (let i = 6, n = 1; i < data.length; i += 7, n++) lines.push(`${(n % 16).toString(16).toUpperCase()}: ${bytes(...data.slice(i, i + 7))}`);
  return lines.join("\r");
}

export function createSimulatedCar(now: () => number = Date.now) {
  const start = now();
  let stored = ["P0171"];
  let pending = ["P0301"];
  let clearedAt = start - 3 * 86_400_000;
  // MAF (0x10) is deliberately unsupported so the UI's "Not supported" state is visible; fuel rate and
  // MAP cover fuel economy and power instead.
  const supported01 = [0x01, 0x03, 0x04, 0x05, 0x06, 0x07, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x11, 0x1f, 0x20];
  const supported21 = [0x21, 0x2f, 0x30, 0x31, 0x33, 0x3c, 0x40];
  const supported41 = [0x42, 0x46, 0x4d, 0x4e, 0x51, 0x5c, 0x5e, 0x60];
  const supported61 = [0x80];
  const supported81 = [0xa0];
  const supportedA1 = [0xa6];

  function state() {
    const t = (now() - start) / 1000;
    const c = t % 90;
    // 0–15 s idle, 15–27 s hard acceleration to 110 km/h, 27–55 s cruise easing to 60, 55–75 s slow to a stop.
    let speed: number;
    let throttle: number;
    if (c < 15) [speed, throttle] = [0, 0];
    else if (c < 27) [speed, throttle] = [110 * Math.pow((c - 15) / 12, 0.75), 85];
    else if (c < 55) [speed, throttle] = [110 - ((c - 27) / 28) * 50, 18];
    else if (c < 75) [speed, throttle] = [60 - ((c - 55) / 20) * 60, 0];
    else [speed, throttle] = [0, 0];
    let gear = 0;
    if (speed > 0.5) {
      gear = 1;
      // Upshift around 3,800 rpm when accelerating, 2,200 rpm when cruising.
      const shift = throttle > 50 ? 3800 : 2200;
      while (gear < 5 && (speed / GEAR_RATIO[gear]) * 1000 > shift) gear++;
    }
    const rpm = gear ? Math.max(900, (speed / GEAR_RATIO[gear]) * 1000) : 780 + 40 * Math.sin(t * 2);
    // Warms from 35 °C to 91 °C over the first two minutes.
    const coolant = Math.min(91, 35 + t * 0.47);
    const load = gear ? 20 + throttle * 0.7 : 22;
    const map = 30 + load * 0.7;
    const fuelRate = gear ? 0.6 + (rpm / 1000) * (0.4 + throttle / 40) : 0.7;
    const odometer = 48_210 + t * 0.012;
    return { speed, rpm, coolant, t, throttle, load, map, fuelRate, odometer };
  }

  function dtcReply(mode: number, codes: string[]) {
    const data = codes.flatMap((code) => DTC_BYTES[code] ?? []);
    return bytes(mode, codes.length, ...data);
  }

  return (raw: string): string => {
    if (raw === "ATZ") return "ELM327 v1.5";
    if (raw === "ATDPN") return "A6";
    if (raw === "ATRV") {
      const s = state();
      return `${(s.rpm > 500 ? 14.1 + 0.1 * Math.sin(s.t / 5) : 12.5).toFixed(1)}V`;
    }
    if (raw.startsWith("AT")) return "OK";
    // "010C1": the trailing response count only applies to Mode 01 PID requests.
    const cmd = /^01[0-9A-F]{2}1$/.test(raw) ? raw.slice(0, 4) : raw;

    const s = state();
    switch (cmd) {
      case "0100":
        return bytes(0x41, 0x00, ...supportedBitmap(0x00, supported01));
      case "0120":
        return bytes(0x41, 0x20, ...supportedBitmap(0x20, supported21));
      case "0140":
        return bytes(0x41, 0x40, ...supportedBitmap(0x40, supported41));
      case "0160":
        return bytes(0x41, 0x60, ...supportedBitmap(0x60, supported61));
      case "0180":
        return bytes(0x41, 0x80, ...supportedBitmap(0x80, supported81));
      case "01A0":
        return bytes(0x41, 0xa0, ...supportedBitmap(0xa0, supportedA1));
      case "0101": {
        // MIL on with one stored code. Spark ignition: catalyst, evap, O2 sensor, O2 heater, EGR supported;
        // evap not yet complete.
        const a = (stored.length ? 0x80 : 0) | stored.length;
        return bytes(0x41, 0x01, a, 0x07, 0b1110_0101, 0b0000_0100);
      }
      case "0104":
        return bytes(0x41, 0x04, (s.load * 255) / 100);
      case "0105":
        return bytes(0x41, 0x05, s.coolant + 40);
      case "0106":
        return bytes(0x41, 0x06, 128 + 4 * Math.sin(s.t));
      case "0107":
        // Long-term trim of about +12 %: consistent with the lean code.
        return bytes(0x41, 0x07, 143);
      case "010B":
        return bytes(0x41, 0x0b, s.map);
      case "010C":
        return bytes(0x41, 0x0c, ...word(s.rpm * 4));
      case "010D":
        return bytes(0x41, 0x0d, s.speed);
      case "010E":
        return bytes(0x41, 0x0e, (12 + s.throttle / 10 + 64) * 2);
      case "010F":
        return bytes(0x41, 0x0f, 32 + 40);
      case "0111":
        return bytes(0x41, 0x11, (s.throttle * 255) / 100);
      case "011F":
        return bytes(0x41, 0x1f, ...word(s.t));
      case "0121":
        return bytes(0x41, 0x21, ...word(37));
      case "012F":
        return bytes(0x41, 0x2f, (62 - s.t / 600) * 2.55);
      case "0130":
        return bytes(0x41, 0x30, 4);
      case "0131":
        return bytes(0x41, 0x31, ...word(118));
      case "0133":
        return bytes(0x41, 0x33, 98);
      case "013C":
        return bytes(0x41, 0x3c, ...word((Math.min(620, 150 + s.t * 4) + 40) * 10));
      case "0142":
        return bytes(0x41, 0x42, ...word(14100 + 100 * Math.sin(s.t / 5)));
      case "0146":
        return bytes(0x41, 0x46, 31 + 40);
      case "014D":
        return bytes(0x41, 0x4d, ...word(52));
      case "014E":
        return bytes(0x41, 0x4e, ...word((now() - clearedAt) / 60_000));
      case "0151":
        return bytes(0x41, 0x51, 1);
      case "015C":
        return bytes(0x41, 0x5c, Math.min(98, 30 + s.t * 0.4) + 40);
      case "015E":
        return bytes(0x41, 0x5e, ...word(s.fuelRate * 20));
      case "01A6": {
        const d = Math.round(s.odometer * 10);
        return bytes(0x41, 0xa6, (d >> 24) & 0xff, (d >> 16) & 0xff, (d >> 8) & 0xff, d & 0xff);
      }
      case "020200":
        return stored.length ? bytes(0x42, 0x02, 0x00, ...DTC_BYTES[stored[0]]) : bytes(0x42, 0x02, 0x00, 0, 0);
      case "020400":
        return bytes(0x42, 0x04, 0x00, 0x55);
      case "020500":
        return bytes(0x42, 0x05, 0x00, 88 + 40);
      case "020600":
        return bytes(0x42, 0x06, 0x00, 150);
      case "020700":
        return bytes(0x42, 0x07, 0x00, 146);
      case "020C00":
        return bytes(0x42, 0x0c, 0x00, ...word(2450 * 4));
      case "020D00":
        return bytes(0x42, 0x0d, 0x00, 64);
      case "021100":
        return bytes(0x42, 0x11, 0x00, 60);
      case "03":
        return dtcReply(0x43, stored);
      case "07":
        return dtcReply(0x47, pending);
      case "0A":
        return dtcReply(0x4a, stored);
      case "04":
        stored = [];
        pending = [];
        clearedAt = now();
        return "44";
      case "0600":
        return bytes(0x46, 0x00, ...supportedBitmap(0x00, [0x01, 0x20]));
      case "0620":
        return bytes(0x46, 0x20, ...supportedBitmap(0x20, [0x21, 0x40]));
      case "0640":
        return bytes(0x46, 0x40, ...supportedBitmap(0x40, [0x41, 0x60]));
      case "0660":
        return bytes(0x46, 0x60, ...supportedBitmap(0x60, [0x80]));
      case "0680":
        return bytes(0x46, 0x80, ...supportedBitmap(0x80, [0xa0]));
      case "06A0":
        return bytes(0x46, 0xa0, ...supportedBitmap(0xa0, [0xa2, 0xa3, 0xa4, 0xa5]));
      case "0601":
        // Rich-to-lean switch time: 72 ms against a 0–120 ms window.
        return multiFrame([0x46, 0x01, 0x05, 0x10, 0x00, 72, 0x00, 0x00, 0x00, 120]);
      case "0621":
        // Catalyst efficiency ratio, passing.
        return multiFrame([0x46, 0x21, 0x83, 0x01, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x64]);
      case "0641":
        return multiFrame([0x46, 0x41, 0x01, 0x14, 0x00, 0x09, 0x00, 0x02, 0x00, 0x20]);
      case "06A2":
        // Cylinder 1 is the one misfiring: 38 misfires this drive against a limit of 25.
        return multiFrame([0x46, 0xa2, 0x0b, 0x24, 0x00, 0x15, 0x00, 0x00, 0xff, 0xff, 0xa2, 0x0c, 0x24, 0x00, 0x26, 0x00, 0x00, 0x00, 0x19]);
      case "06A3":
      case "06A4":
      case "06A5": {
        const mid = parseInt(cmd.slice(2), 16);
        return multiFrame([0x46, mid, 0x0b, 0x24, 0x00, 0x01, 0x00, 0x00, 0xff, 0xff, mid, 0x0c, 0x24, 0x00, 0x00, 0x00, 0x00, 0x00, 0x19]);
      }
      case "0902":
        return multiFrame([0x49, 0x02, 0x01, ...[...VIN].map((ch) => ch.charCodeAt(0))]);
      case "0904": {
        const id = [..."SIM-ECU-1.2.0"].map((ch) => ch.charCodeAt(0));
        return multiFrame([0x49, 0x04, 0x01, ...id, ...new Array(16 - id.length).fill(0)]);
      }
      case "090A": {
        const name = [..."ECM-EngineControl"].map((ch) => ch.charCodeAt(0));
        return multiFrame([0x49, 0x0a, 0x01, ...name, ...new Array(20 - name.length).fill(0)]);
      }
      default:
        return "NO DATA";
    }
  };
}
