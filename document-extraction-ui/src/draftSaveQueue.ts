/** Serialize draft writes so a slow older request can never overwrite a newer edit. */
export class DraftSaveQueue<T, R> {
  private tail: Promise<unknown> = Promise.resolve();
  private last?: { signature: string; promise: Promise<R> };
  private write: (value: T) => Promise<R>;
  private acknowledge: (result: R, submitted: T) => void;
  private changed: () => void;
  pending = 0;

  constructor(
    write: (value: T) => Promise<R>,
    acknowledge: (result: R, submitted: T) => void,
    changed: () => void = () => {},
  ) { this.write = write; this.acknowledge = acknowledge; this.changed = changed; }

  save(value: T): Promise<R> {
    const submitted = structuredClone(value);
    const signature = JSON.stringify(submitted);
    if (this.last?.signature === signature) return this.last.promise;
    this.pending++;
    this.changed();
    const promise = this.tail.catch(() => {}).then(async () => {
      const result = await this.write(submitted);
      this.acknowledge(result, submitted);
      return result;
    });
    this.last = { signature, promise };
    this.tail = promise.then(() => {}, () => {}).finally(() => {
      this.pending--;
      if (this.last?.promise === promise) this.last = undefined;
      this.changed();
    });
    return promise;
  }
}
