export interface Transport {
  /** True for transports that replay canned data; the UI must label these "Simulated". */
  readonly simulated: boolean;
  write(data: string): Promise<void>;
  /** Subscribe to incoming text chunks. Returns an unsubscribe function. */
  onData(cb: (chunk: string) => void): () => void;
  disconnect(): Promise<void>;
}
