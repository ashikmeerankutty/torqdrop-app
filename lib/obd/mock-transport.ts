import type { Transport } from "./transport";

type Replies = Record<string, string> | ((command: string) => string);

/** Replays canned replies keyed by command. Everything it produces is "Simulated" in the UI. */
export class MockTransport implements Transport {
  readonly simulated = true;
  private listeners = new Set<(chunk: string) => void>();
  readonly written: string[] = [];

  /**
   * `replies` is a fixed table, or a function for a car whose readings change over time.
   * `latencyMs` mimics a real adapter's round trip so polling runs at a realistic rate.
   */
  constructor(
    private replies: Replies,
    private latencyMs = 0,
  ) {}

  async write(data: string): Promise<void> {
    const cmd = data.replace(/\r$/, "");
    this.written.push(cmd);
    const reply =
      typeof this.replies === "function" ? this.replies(cmd.toUpperCase()) : (this.replies[cmd.toUpperCase()] ?? "NO DATA");
    // Mimic a real adapter: echo-free reply terminated by a prompt, delivered asynchronously.
    setTimeout(() => this.listeners.forEach((l) => l(`${reply}\r\r>`)), this.latencyMs);
  }

  onData(cb: (chunk: string) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  async disconnect(): Promise<void> {
    this.listeners.clear();
  }
}
