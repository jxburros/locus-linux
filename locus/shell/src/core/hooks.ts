/*
 * Small reusable hooks used across the shell and apps.
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { storage } from "./storage";
import { allObjects, subscribe as subscribeObjects } from "./objects";
import type { ObjectType, SystemObject } from "@/types";

/** A ticking clock. Re-renders every `intervalMs` (default 1s). */
export function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * A gateable clock for tile lifecycle states (spec §20): live tiles tick,
 * warm/sleeping/snapshot tiles hold their last value. Low-power mode slows the
 * cadence by passing a larger interval.
 */
export function useTileNow(intervalMs: number, live: boolean): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!live) return;
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs, live]);
  return now;
}

/** Reactively read a matchMedia query. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const handler = () => setMatches(mq.matches);
    handler();
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [query]);
  return matches;
}

/**
 * Bind a piece of React state to a storage key. Reads through storage, writes
 * through storage, and re-renders when *anything* writes that key (including
 * other tabs). This is how apps persist without knowing storage internals.
 */
export function useStoredValue<T>(
  key: string,
  fallback: T,
): [T, (next: T) => void] {
  const value = useSyncExternalStore(
    (cb) => storage.subscribe(key, cb),
    () => storage.get<T>(key, fallback),
  );
  const setValue = (next: T) => storage.set(key, next);
  return [value, setValue];
}

/**
 * Live view of every object in the store. Re-renders on any object write.
 * `allObjects()` returns the store's cached array (a stable reference until a
 * write replaces it), which is exactly what useSyncExternalStore needs.
 */
export function useObjects(): SystemObject[] {
  return useSyncExternalStore(subscribeObjects, allObjects);
}

/** Live view of one object type, derived from the stable full list. */
export function useObjectsOfType(type: ObjectType): SystemObject[] {
  const all = useObjects();
  return useMemo(() => all.filter((o) => o.type === type), [all, type]);
}
