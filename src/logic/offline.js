// Offline earnings from timestamps (capped) + the "sen yokken" welcome-back summary.
import { CFG } from './config.js';
import { advance } from './economy.js';

// Returns null if the gap is too short for a popup; otherwise a summary. Mutates state.
export function catchUp(state, now) {
  const last = typeof state.lastTick === 'number' ? state.lastTick : now;
  let gap = (now - last) / 1000;
  if (!(gap > 0)) { state.lastTick = now; return null; }  // clock went backwards: ignore
  const capped = Math.min(gap, CFG.offlineCapSec);
  const moneyBefore = state.money;
  const res = advance(state, capped, { auto: true });
  const naps = Math.min(CFG.catNapOfflineMax, Math.floor(capped / CFG.catNapOfflineEverySec));
  state.catNaps += naps;
  state.lastTick = now;
  if (gap < CFG.offlineMinSec) return null;
  return {
    awaySec: gap, simulatedSec: capped, capped: gap > CFG.offlineCapSec,
    projects: res.delivered.length, earned: state.money - moneyBefore, catNaps: naps
  };
}

// pick a welcome-back text template (keys of tr.json welcome.lines / welcome.quiet)
export function welcomeTemplate(summary, seedish) {
  if (!summary) return null;
  if (summary.projects === 0) return { key: 'welcome.quiet', index: 0 };
  return { key: 'welcome.lines', index: Math.abs(Math.floor(seedish || 0)) % 4 };
}
