// Cloud save merge rule (pure). Same rule as Kodhane: higher lifetime earnings wins; on a tie the newer one.
export function chooseWinner(local, localTime, cloud, cloudTime) {
  if (!cloud) return 'local';
  if (!local) return 'cloud';
  const n = (x) => (typeof x === 'number' && isFinite(x) ? x : 0);
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
