// Guided first minutes: one hint at a time, one sentence, disappears when done.
// Steps: 0 laptop -> 1 basla (first delivery) -> 2 stajyer (first hire) -> 3 teklif (accept a 2nd project) -> done.
export const STEPS = ['laptop', 'basla', 'stajyer', 'teklif'];

// what to show right now: { key: 'tutorial.<id>', target: 'laptop'|'ekip'|'teklif'|null } or null
export function currentHint(state, ui = {}) {
  const tu = state.tutorial;
  // v2: one-time tip for the first Proje Yöneticisi (while placing their desk, or right after the hire)
  if (ui.tip) return { key: ui.tip, target: 'placement' };
  if (ui.placingPm && !state.flags.pmTip) return { key: 'tutorial.pm', target: 'placement' };
  if (ui.placingItem || (ui.placingDesk && ui.glow && tu.done)) return { key: 'items.area', target: 'placement' };
  if (tu.done) return null;
  if (ui.placingDesk) return { key: 'tutorial.masa', target: 'placement' };
  switch (STEPS[tu.step]) {
    case 'laptop': return { key: 'tutorial.laptop', target: 'laptop' };
    case 'basla': return state.projects.length ? { key: 'tutorial.basla', target: 'laptop' } : { key: 'tutorial.laptop', target: 'laptop' };
    case 'stajyer': return { key: 'tutorial.stajyer', target: 'ekip' };
    case 'teklif': return state.offers.length ? { key: 'tutorial.teklif', target: 'teklif' } : null;
    default: return null;
  }
}
function advanceTo(state, step) {
  if (state.tutorial.step < step) state.tutorial.step = step;
  if (state.tutorial.step >= STEPS.length) state.tutorial.done = true;
}
// feed game happenings: 'laptop' | 'accepted' | 'delivered' | 'hired'
export function notify(state, what) {
  const s = STEPS[state.tutorial.step];
  if (state.tutorial.done) return false;
  const before = state.tutorial.step;
  if (s === 'laptop' && (what === 'laptop' || what === 'accepted')) advanceTo(state, 1);
  if (state.tutorial.step === 1 && what === 'delivered') advanceTo(state, 2);
  if (STEPS[state.tutorial.step] === 'stajyer' && what === 'hired') advanceTo(state, 3);
  if (STEPS[state.tutorial.step] === 'teklif' && what === 'accepted' && before === 3) advanceTo(state, 4);
  return state.tutorial.step !== before;
}
export function shouldAskCloud(state) {
  return !state.flags.cloudAsked && state.playSec >= 300 && state.staff.length >= 2;
}
