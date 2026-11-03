import type { Transport } from "./transport";

export type ObdError =
  | "NO_DATA"
  | "UNABLE_TO_CONNECT"
  | "BUS_ERROR"
  | "UNKNOWN_COMMAND"
  | "TIMEOUT";

export class ObdCommandError extends Error {
  constructor(
    readonly code: ObdError,
    readonly command: string,
  ) {
    super(`${code} for "${command}"`);
  }
}

const INIT_SEQUENCE = ["ATZ", "ATE0", "ATL0", "ATS0", "ATH0", "ATSP0"];

const ERROR_PATTERNS: [RegExp, ObdError][] = [
  [/NO DATA/, "NO_DATA"],
  [/UNABLE TO CONNECT/, "UNABLE_TO_CONNECT"],
  [/BUS INIT|BUS BUSY|BUS ERROR|CAN ERROR|FB ERROR|DATA ERROR|LV RESET|STOPPED/, "BUS_ERROR"],
  [/^\?$/, "UNKNOWN_COMMAND"],
];

/** Split a raw reply into trimmed, non-empty lines, dropping the command echo and search chatter. */
export function cleanReply(raw: string, command: string): string[] {
  return raw
    .replace(/>/g, "")
    .split(/[\r\n]+/)
    .map((l) => l.trim().toUpperCase())
    .filter((l) => l && l !== command.toUpperCase() && l !== "SEARCHING..." && l !== "OK");
}

/**
 * ELM327 driver: one command in flight at a time, each reply ends at the `>` prompt.
 */
export class Elm327 {
  private buffer = "";
  private waiter: ((raw: string) => void) | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private unsubscribe: () => void;

  constructor(
    private transport: Transport,
    private opts: { timeoutMs?: number; retries?: number } = {},
  ) {
    this.unsubscribe = transport.onData((chunk) => this.handleChunk(chunk));
  }

  private handleChunk(chunk: string) {
    this.buffer += chunk;
    if (this.buffer.includes(">") && this.waiter) {
      const raw = this.buffer;
      this.buffer = "";
      const w = this.waiter;
      this.waiter = null;
      w(raw);
    }
  }

  async init(): Promise<void> {
    for (const cmd of INIT_SEQUENCE) {
      // ATZ resets the chip and can take over a second; "?" on it is harmless to ignore.
      await this.send(cmd, { timeoutMs: cmd === "ATZ" ? 3000 : undefined }).catch((e) => {
        if (!(e instanceof ObdCommandError && e.code === "UNKNOWN_COMMAND")) throw e;
      });
    }
  }

  /** Send a command, resolving with its cleaned reply lines. Calls are serialised. */
  send(command: string, o: { timeoutMs?: number } = {}): Promise<string[]> {
    const run = () => this.sendWithRetry(command, o.timeoutMs ?? this.opts.timeoutMs ?? 2000);
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async sendWithRetry(command: string, timeoutMs: number): Promise<string[]> {
    const retries = this.opts.retries ?? 1;
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.sendOnce(command, timeoutMs);
      } catch (e) {
        // Only transient timeouts are retried. NO DATA and friends are real answers.
        const retryable = e instanceof ObdCommandError && e.code === "TIMEOUT";
        if (!retryable || attempt >= retries) throw e;
      }
    }
  }

  private sendOnce(command: string, timeoutMs: number): Promise<string[]> {
    return new Promise((resolve, reject) => {
      this.buffer = "";
      const timer = setTimeout(() => {
        this.waiter = null;
        reject(new ObdCommandError("TIMEOUT", command));
      }, timeoutMs);
      this.waiter = (raw) => {
        clearTimeout(timer);
        const lines = cleanReply(raw, command);
        for (const line of lines) {
          for (const [re, code] of ERROR_PATTERNS) {
            if (re.test(line)) return reject(new ObdCommandError(code, command));
          }
        }
        resolve(lines);
      };
      this.transport.write(command + "\r").catch((e) => {
        clearTimeout(timer);
        this.waiter = null;
        reject(e);
      });
    });
  }

  async close(): Promise<void> {
    this.unsubscribe();
    await this.transport.disconnect();
  }
}
