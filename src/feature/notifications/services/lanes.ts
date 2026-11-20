/** Runs jobs per key, at most `limit` of one key at a time; a slow key never holds another. */
export class Lanes {
  private readonly active = new Map<string, number>();
  private readonly waiting = new Map<string, (() => void)[]>();

  async run<T>(key: string, limit: number, job: () => Promise<T>): Promise<T> {
    while ((this.active.get(key) ?? 0) >= limit) {
      await new Promise<void>((resolve) => {
        this.waiting.set(key, [...(this.waiting.get(key) ?? []), resolve]);
      });
    }
    this.active.set(key, (this.active.get(key) ?? 0) + 1);
    try {
      return await job();
    } finally {
      const left = (this.active.get(key) ?? 1) - 1;
      if (left === 0) this.active.delete(key);
      else this.active.set(key, left);
      const next = this.waiting.get(key)?.shift();
      if (this.waiting.get(key)?.length === 0) this.waiting.delete(key);
      next?.();
    }
  }
}
