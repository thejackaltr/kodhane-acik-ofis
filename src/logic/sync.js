// Cloud save merge rule (pure). Same rule as Kodhane: higher lifetime earnings wins; on a tie the newer one.
// v2.2 (Backend notes): if the cloud row's revision is above the local last-seen revision, the cloud wins regardless of
// earnings (a reset/restore/newer write happened elsewhere; the local copy is backed up by the caller). Otherwise the
// old rule. A higher LOCAL revision never wins by itself (guest resets bump it locally only).
export function chooseWinner(local, localTime, cloud, cloudTime) {
  if (!cloud) return 'local';
  if (!local) return 'cloud';
  const n = (x) => (typeof x === 'number' && isFinite(x) ? x : 0);
  const cR = n(cloud.revision), lR = n(local.revision);
  if (cR > lR) return 'cloud';
  const cE = n(cloud.totalEarned), lE = n(local.totalEarned);
  if (cE > lE) return 'cloud';
  if (cE < lE) return 'local';
  return n(cloudTime) > n(localTime) ? 'cloud' : 'local';
}
// Back up the loser unless it is just an older copy of the same game (same start, <= earnings, older).
export function needsBackup(loser, loserTime, winner, winnerTime) {
  const n = (x) => (typeof x === 'number' && isFinite(x) ? x : 0);
  if (!loser || n(loser.totalEarned) <= 0) return false;
  const sameGame = n(loser.startedAt) && n(loser.startedAt) === n(winner && winner.startedAt);
  return !(sameGame && n(loser.totalEarned) <= n(winner.totalEarned) && loserTime <= winnerTime);
}
