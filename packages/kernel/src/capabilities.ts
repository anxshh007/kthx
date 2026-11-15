import { CAPABILITIES, type Capability, type CapabilityMap } from './shared/types';

export type ProbeResult = { ok: boolean; detail: string };
export type Probe = () => Promise<ProbeResult>;

/**
 * Holds the live result of probing each capability with a real call.
 * The Studio and CLI render only what this registry says can run.
 */
export class CapabilityRegistry {
  private state: CapabilityMap;
  private probes = new Map<Capability, Probe>();
  private listeners = new Set<(map: CapabilityMap) => void>();
  private running: Promise<CapabilityMap> | null = null;

  constructor() {
    const now = new Date().toISOString();
    this.state = Object.fromEntries(
      CAPABILITIES.map((c) => [c, { available: false, detail: 'Not checked yet', checkedAt: now }]),
    ) as CapabilityMap;
  }

  setProbe(cap: Capability, probe: Probe): void {
    this.probes.set(cap, probe);
  }

  has(cap: Capability): boolean {
    return this.state[cap].available;
  }

  hasAll(caps: readonly Capability[]): boolean {
    return caps.every((c) => this.has(c));
  }

  snapshot(): CapabilityMap {
    return structuredClone(this.state);
  }

  set(cap: Capability, ok: boolean, detail: string): void {
    const prev = this.state[cap].available;
    this.state[cap] = { available: ok, detail, checkedAt: new Date().toISOString() };
    if (prev !== ok) this.notify();
  }

  onChange(listener: (map: CapabilityMap) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const snap = this.snapshot();
    for (const l of this.listeners) l(snap);
  }

  get probing(): boolean {
    return this.running !== null;
  }

  /**
   * Runs every probe in registration order (later probes may rely on earlier
   * ones, e.g. structured output after text); concurrent callers share one run.
   */
  refresh(): Promise<CapabilityMap> {
    if (this.running) return this.running;
    this.running = (async () => {
      const before = JSON.stringify(Object.values(this.state).map((s) => s.available));
      for (const [cap, probe] of this.probes.entries()) {
        let res: ProbeResult;
        try {
          res = await probe();
        } catch (err) {
          res = { ok: false, detail: err instanceof Error ? err.message : String(err) };
        }
        this.state[cap] = {
          available: res.ok,
          detail: res.detail,
          checkedAt: new Date().toISOString(),
        };
      }
      const after = JSON.stringify(Object.values(this.state).map((s) => s.available));
      if (before !== after) this.notify();
      return this.snapshot();
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }
}
