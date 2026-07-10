/**
 * Deterministic cache-freshness logic for confirmed SUTS jurisdiction codes.
 * Port of the Python `freshness.py` — pure date math, no I/O. See CONTRACT.md.
 *
 * Fresh as of `asOf` iff BOTH:
 *   1. (asOf - confirmed).days <= TTL_DAYS, and
 *   2. confirmed >= lastReset(asOf)  (Colorado rates reset Jan 1 / Jul 1).
 */

export const TTL_DAYS = 90;

// Colorado local rate changes take effect Jan 1 and Jul 1 by statute.
// [month, day] — change here if the statutory boundaries ever move.
export const RESET_BOUNDARIES: [number, number][] = [
  [1, 1],
  [7, 1],
];

const DAY_MS = 86_400_000;

function parseISO(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) throw new Error(`invalid date: ${s}`);
  return new Date(Date.UTC(y, m - 1, d));
}

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / DAY_MS);
}

function boundariesNear(year: number): Date[] {
  const out: Date[] = [];
  for (const y of [year - 1, year, year + 1]) {
    for (const [m, d] of RESET_BOUNDARIES) out.push(new Date(Date.UTC(y, m - 1, d)));
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}

export function lastReset(d: Date): Date {
  const before = boundariesNear(d.getUTCFullYear()).filter((b) => b.getTime() <= d.getTime());
  return before[before.length - 1];
}

export function nextReset(d: Date): Date {
  return boundariesNear(d.getUTCFullYear()).find((b) => b.getTime() > d.getTime())!;
}

export function expiresOn(confirmed: Date): Date {
  const ttl = addDays(confirmed, TTL_DAYS);
  const nr = nextReset(confirmed);
  return ttl.getTime() <= nr.getTime() ? ttl : nr;
}

export interface FreshnessResult {
  fresh: boolean;
  reason: string;
  expires_on: string;
}

export function checkFreshness(confirmedDate: string, asOf?: string): FreshnessResult {
  const confirmed = parseISO(confirmedDate);
  const ref = asOf ? parseISO(asOf) : parseISO(toISO(new Date()));

  const age = daysBetween(ref, confirmed);
  const reset = lastReset(ref);
  const exp = expiresOn(confirmed);

  let fresh: boolean;
  let reason: string;
  if (age > TTL_DAYS) {
    fresh = false;
    reason = `stale - confirmed ${confirmedDate} is ${age} days old, exceeds the ${TTL_DAYS}-day TTL`;
  } else if (confirmed.getTime() < reset.getTime()) {
    fresh = false;
    reason = `stale - a rate reset on ${toISO(reset)} occurred after the code was confirmed (${confirmedDate})`;
  } else {
    fresh = true;
    reason = `fresh - confirmed ${confirmedDate} is ${age} days old, within the ${TTL_DAYS}-day TTL and on/after the ${toISO(reset)} reset`;
  }
  return { fresh, reason, expires_on: toISO(exp) };
}
