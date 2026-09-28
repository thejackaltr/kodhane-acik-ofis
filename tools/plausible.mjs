// JS mirror of the server rule public.acik_ofis_score_plausible (kodhane-cloud/leaderboard.sql v5) for tests + tuning.
// Keep both in sync. Returns { ok, limit } where limit = the largest totalEarned the rule accepts for this save now.
const LAUNCH = Date.UTC(2026, 8, 27);
const TYPES = [[40, 1.405], [450, 5.58], [1100, 10.45], [3800, 18.7], [30000, 76.2], [8000, 4.7]];
const MULT = 1.581 * 1.48 * 3 * 3 * 2 * 2.25;
export function aoPlausible(d, nowMs) {
  if (!d || typeof d.totalEarned !== 'number' || d.totalEarned < 0) return { ok: false, limit: 0 };
  const t = d.totalEarned;
  if (typeof d.money === 'number' && d.money > t + 1) return { ok: false, limit: 0 };
  const stg = typeof d.stage === 'number' ? Math.floor(d.stage) : 0;
  if (stg < 0 || stg > 2 || (stg >= 1 && t < 3000) || (stg >= 2 && t < 200000)) return { ok: false, limit: 0 };
  if (Array.isArray(d.staff) && d.staff.length > 200) return { ok: false, limit: 0 };
  let st = typeof d.startedAt === 'number' ? d.startedAt : null; const ls = typeof d.lastSaved === 'number' ? d.lastSaved : null;
  if (st == null || st < LAUNCH) st = LAUNCH;
  let e = Math.max(nowMs - st, ls != null ? ls - st : 0, 0);
  e = Math.min(e, Math.max(nowMs - LAUNCH, 0)) / 1000 + 3600;
  let base = 1.54;
  for (const [c, w] of TYPES) base += w * Math.min(200, Math.floor(Math.log(t * 0.15 / c + 1) / Math.log(1.15)));
  const r = base * MULT + 20 * 2 * (2 + 0.04 * base * 1.581 * 1.48 * 3) * 1.35 * 3 * 2.25 + 100;
  return { ok: t <= 2 * e * r, limit: 2 * e * r };
}
