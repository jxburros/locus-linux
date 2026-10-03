/*
 * Single-scheduler election (shared foundation F4).
 * ---------------------------------------------------------------------------
 * Locus can be open in several tabs at once, but each periodic job — the Time
 * Core tick, the Monitor evaluator — must run in exactly one of them, or
 * alarms fire twice and watch state is last-writer-wins. Election is a
 * heartbeat lease in localStorage: the leader stamps the lease every tick;
 * any tab may take over once the lease goes stale (leader closed or froze).
 *
 * The lease is written with raw localStorage on purpose: it is scheduler
 * infrastructure, not app data, and routing it through core/storage would
 * ping every "*" subscriber on each heartbeat.
 */

const LEASE_PREFIX = "locus:scheduler.lease.";
/** A lease older than this is considered abandoned and can be taken. */
const LEASE_TTL_MS = 20_000;

const tabId = `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

interface Lease {
  id: string;
  at: number;
}

function readLease(name: string): Lease | null {
  try {
    const raw = localStorage.getItem(LEASE_PREFIX + name);
    return raw ? (JSON.parse(raw) as Lease) : null;
  } catch {
    return null;
  }
}

function writeLease(name: string): boolean {
  try {
    localStorage.setItem(LEASE_PREFIX + name, JSON.stringify({ id: tabId, at: Date.now() }));
    return true;
  } catch {
    // Storage full/blocked: the lease can't be recorded.
    return false;
  }
}

function releaseLease(name: string): void {
  const lease = readLease(name);
  if (lease?.id === tabId) {
    try {
      localStorage.removeItem(LEASE_PREFIX + name);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Is this tab the current leader for the named job? Claims or renews the
 * lease as a side effect, so call it once per tick and skip work when false.
 * The claim is verified with a re-read after writing: two tabs racing for a
 * stale lease both write, but only the one whose write survived proceeds.
 */
export function claimLeadership(name: string): boolean {
  const lease = readLease(name);
  const now = Date.now();
  if (!lease || lease.id === tabId || now - lease.at > LEASE_TTL_MS) {
    // If the lease can't be persisted (storage full/blocked), degrade to
    // running the job locally rather than electing nobody. A missed tick
    // (alarms never fire) is worse than the pre-election worst case of every
    // blocked tab running the job; the TTL still limits real duplication.
    if (!writeLease(name)) return true;
    return readLease(name)?.id === tabId;
  }
  return false;
}

export interface ScheduledJob {
  stop: () => void;
  /** True when this tab currently holds the job's lease. */
  isLeader: () => boolean;
}

/**
 * Run `tick` every `intervalMs`, in exactly one tab. Every open tab keeps a
 * timer, but only the lease-holder does the work; if the leader disappears,
 * another tab takes over within one lease TTL. The lease is released on
 * pagehide so takeover is usually immediate.
 */
export function startElectedInterval(
  name: string,
  intervalMs: number,
  tick: () => void,
): ScheduledJob {
  let leader = false;
  const run = () => {
    leader = claimLeadership(name);
    if (!leader) return;
    try {
      tick();
    } catch (err) {
      console.warn(`[locus:scheduler] ${name} tick failed`, err);
    }
  };
  run();
  const timer = window.setInterval(run, intervalMs);
  const onHide = () => releaseLease(name);
  window.addEventListener("pagehide", onHide);
  return {
    stop: () => {
      window.clearInterval(timer);
      window.removeEventListener("pagehide", onHide);
      releaseLease(name);
    },
    isLeader: () => leader,
  };
}
