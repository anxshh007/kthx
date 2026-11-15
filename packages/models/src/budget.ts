import type { Priority } from './types';

interface Waiter {
  priority: Priority;
  seq: number;
  resolve: () => void;
  reject: (err: unknown) => void;
  signal?: AbortSignal;
}

/**
 * Per-provider rate budget: a token bucket refilled at `rpm` per minute, with a
 * priority queue so interactive work always goes before background work.
 */
export class RateBudget {
  private tokens: number;
  private last = Date.now();
  private queue: Waiter[] = [];
  private seq = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private rpm: number) {
    this.tokens = Math.max(1, rpm);
  }

  setRpm(rpm: number): void {
    this.rpm = Math.max(1, rpm);
    this.tokens = Math.min(this.tokens, this.rpm);
  }

  get waiting(): number {
    return this.queue.length;
  }

  private refill(): void {
    const now = Date.now();
    this.tokens = Math.min(this.rpm, this.tokens + ((now - this.last) / 60_000) * this.rpm);
    this.last = now;
  }

  acquire(priority: Priority, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = { priority, seq: this.seq++, resolve, reject, signal };
      this.queue.push(waiter);
      this.queue.sort((a, b) =>
        a.priority === b.priority ? a.seq - b.seq : a.priority === 'interactive' ? -1 : 1,
      );
      signal?.addEventListener(
        'abort',
        () => {
          const i = this.queue.indexOf(waiter);
          if (i >= 0) {
            this.queue.splice(i, 1);
            reject(signal.reason ?? new Error('Aborted'));
          }
        },
        { once: true },
      );
      this.drain();
    });
  }

  private drain(): void {
    this.refill();
    while (this.queue.length && this.tokens >= 1) {
      const next = this.queue.shift() as Waiter;
      this.tokens -= 1;
      next.resolve();
    }
    if (this.queue.length && !this.timer) {
      const waitMs = Math.ceil(((1 - this.tokens) / this.rpm) * 60_000);
      this.timer = setTimeout(
        () => {
          this.timer = null;
          this.drain();
        },
        Math.max(50, waitMs),
      );
    }
  }
}
