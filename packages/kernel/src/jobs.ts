import { shortId } from './shared/text';

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type JobPriority = 'interactive' | 'background';

export interface JobRecord {
  id: string;
  type: string;
  projectId: string | null;
  status: JobStatus;
  priority: JobPriority;
  label: string;
  input: unknown;
  state: unknown;
  progress: number;
  message: string;
  result: unknown;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobStorage {
  insert(job: JobRecord): void;
  update(id: string, patch: Partial<JobRecord>): void;
  get(id: string): JobRecord | null;
  listByStatus(statuses: JobStatus[]): JobRecord[];
}

export interface JobContext {
  progress(fraction: number, message: string): void;
  /** Persists resumable state; a restarted job receives it back as `job.state`. */
  checkpoint(state: unknown): void;
  signal: AbortSignal;
}

export type JobHandler = (job: JobRecord, ctx: JobContext) => Promise<unknown>;

export class JobCancelledError extends Error {
  constructor() {
    super('Cancelled');
  }
}

/**
 * Persisted job queue. Jobs survive restarts: anything that was running when
 * the process stopped is put back in the queue and resumes from its checkpoint.
 */
export class JobQueue {
  private handlers = new Map<string, JobHandler>();
  private active = new Map<string, AbortController>();
  private listeners = new Set<(job: JobRecord) => void>();
  private started = false;
  private pumping = false;

  constructor(
    private storage: JobStorage,
    private concurrency = 2,
  ) {}

  register(type: string, handler: JobHandler): void {
    this.handlers.set(type, handler);
  }

  onUpdate(listener: (job: JobRecord) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(id: string): void {
    const job = this.storage.get(id);
    if (!job) return;
    for (const l of this.listeners) l(job);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    for (const job of this.storage.listByStatus(['running'])) {
      this.storage.update(job.id, {
        status: 'queued',
        message: 'Resuming after restart',
        updatedAt: new Date().toISOString(),
      });
    }
    this.pump();
  }

  stop(): void {
    this.started = false;
    for (const c of this.active.values()) c.abort();
  }

  enqueue(
    type: string,
    input: unknown,
    opts: { projectId?: string | null; priority?: JobPriority; label?: string } = {},
  ): JobRecord {
    const now = new Date().toISOString();
    const job: JobRecord = {
      id: shortId(),
      type,
      projectId: opts.projectId ?? null,
      status: 'queued',
      priority: opts.priority ?? 'background',
      label: opts.label ?? type,
      input,
      state: null,
      progress: 0,
      message: 'Waiting to start',
      result: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    this.storage.insert(job);
    this.emit(job.id);
    this.pump();
    return job;
  }

  cancel(id: string): boolean {
    const job = this.storage.get(id);
    if (!job || (job.status !== 'queued' && job.status !== 'running')) return false;
    this.active.get(id)?.abort();
    this.storage.update(id, {
      status: 'cancelled',
      message: 'Cancelled',
      updatedAt: new Date().toISOString(),
    });
    this.emit(id);
    return true;
  }

  retry(id: string): JobRecord | null {
    const job = this.storage.get(id);
    if (!job || (job.status !== 'failed' && job.status !== 'cancelled')) return null;
    this.storage.update(id, {
      status: 'queued',
      error: null,
      message: 'Trying again',
      updatedAt: new Date().toISOString(),
    });
    this.emit(id);
    this.pump();
    return this.storage.get(id);
  }

  /** Resolves when the job reaches a final state. */
  wait(id: string, timeoutMs = 120_000): Promise<JobRecord> {
    return new Promise((resolve, reject) => {
      const done = (j: JobRecord | null) =>
        j && (j.status === 'succeeded' || j.status === 'failed' || j.status === 'cancelled');
      const now = this.storage.get(id);
      if (done(now)) return resolve(now as JobRecord);
      const timer = setTimeout(() => {
        off();
        reject(new Error('Timed out waiting for job'));
      }, timeoutMs);
      const off = this.onUpdate((j) => {
        if (j.id === id && done(j)) {
          clearTimeout(timer);
          off();
          resolve(j);
        }
      });
    });
  }

  private pump(): void {
    if (!this.started || this.pumping) return;
    this.pumping = true;
    try {
      while (this.active.size < this.concurrency) {
        const queued = this.storage
          .listByStatus(['queued'])
          .filter((j) => this.handlers.has(j.type) && !this.active.has(j.id))
          .sort((a, b) =>
            a.priority === b.priority
              ? a.createdAt.localeCompare(b.createdAt)
              : a.priority === 'interactive'
                ? -1
                : 1,
          );
        const next = queued[0];
        if (!next) break;
        this.run(next);
      }
    } finally {
      this.pumping = false;
    }
  }

  private run(job: JobRecord): void {
    const handler = this.handlers.get(job.type) as JobHandler;
    const controller = new AbortController();
    this.active.set(job.id, controller);
    this.storage.update(job.id, {
      status: 'running',
      message: job.state ? 'Resuming' : 'Started',
      updatedAt: new Date().toISOString(),
    });
    this.emit(job.id);
    const ctx: JobContext = {
      signal: controller.signal,
      progress: (fraction, message) => {
        if (controller.signal.aborted) return;
        this.storage.update(job.id, {
          progress: Math.max(0, Math.min(1, fraction)),
          message,
          updatedAt: new Date().toISOString(),
        });
        this.emit(job.id);
      },
      checkpoint: (state) => {
        if (controller.signal.aborted) return;
        this.storage.update(job.id, { state, updatedAt: new Date().toISOString() });
      },
    };
    const fresh = this.storage.get(job.id) ?? job;
    handler(fresh, ctx)
      .then((result) => {
        if (controller.signal.aborted || !this.started) return;
        this.storage.update(job.id, {
          status: 'succeeded',
          progress: 1,
          message: 'Done',
          result: result ?? null,
          updatedAt: new Date().toISOString(),
        });
      })
      .catch((err: unknown) => {
        if (!this.started) return;
        if (controller.signal.aborted && this.storage.get(job.id)?.status === 'cancelled') return;
        this.storage.update(job.id, {
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
          message: err instanceof Error ? err.message : 'Something went wrong',
          updatedAt: new Date().toISOString(),
        });
      })
      .finally(() => {
        this.active.delete(job.id);
        if (!this.started) return;
        this.emit(job.id);
        this.pump();
      });
  }
}
