export type Listener<T> = (payload: T) => void;

/** Small typed event bus. Listeners never throw back into the emitter. */
export class EventBus<Events extends { [K in keyof Events]: unknown }> {
  private listeners = new Map<keyof Events, Set<Listener<never>>>();

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as Listener<never>);
    return () => set.delete(listener as Listener<never>);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const l of set) {
      try {
        (l as Listener<Events[K]>)(payload);
      } catch {
        // A faulty listener must not break the emitter.
      }
    }
  }
}

export interface KathixEvents {
  'job.updated': { id: string; type: string; status: string; progress: number; message: string };
  'capabilities.changed': { capabilities: Record<string, { available: boolean }> };
  'ledger.event': { projectId: string | null; kind: string };
  'script.saved': { projectId: string; scriptId: string; versionId: string };
  'showrunner.updated': { runId: string; status: string };
}
