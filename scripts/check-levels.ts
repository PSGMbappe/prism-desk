/**
 * Brute-force solver: proves every level is solvable with its tray and
 * reports the fewest mirrors needed. Run with `npm run check:levels`.
 */
import {
  cellKey,
  isOpenCell,
  LEVELS,
  traceBeam,
  type Level,
  type MirrorKind,
} from '../src/puzzle.ts';

function solve(level: Level): { mirrors: number; layout: string[] } | null {
  const open: [number, number][] = [];
  for (let c = 0; c < level.cols; c++)
    for (let r = 0; r < level.rows; r++)
      if (isOpenCell(level, c, r)) open.push([c, r]);

  const slashes = level.tray.filter((k) => k === '/').length;
  const backs = level.tray.length - slashes;
  let best: { mirrors: number; layout: string[] } | null = null;
  const placed = new Map<string, MirrorKind>();

  const dfs = (i: number, s: number, b: number) => {
    const n = placed.size;
    if (best && n >= best.mirrors) return;
    if (traceBeam(level, placed).solved) {
      best = {
        mirrors: n,
        layout: [...placed].map(([k, v]) => `${v}@${k}`),
      };
      return;
    }
    if (i >= open.length) return;
    const key = cellKey(open[i][0], open[i][1]);
    if (s > 0) {
      placed.set(key, '/');
      dfs(i + 1, s - 1, b);
      placed.delete(key);
    }
    if (b > 0) {
      placed.set(key, '\\');
      dfs(i + 1, s, b - 1);
      placed.delete(key);
    }
    dfs(i + 1, s, b);
  };
  dfs(0, slashes, backs);
  return best;
}

let failed = 0;
LEVELS.forEach((level, i) => {
  if (traceBeam(level, new Map()).solved) {
    console.log(`L${i + 1} ${level.name}: FAIL — solved with no mirrors`);
    failed++;
    return;
  }
  const result = solve(level);
  if (!result) {
    console.log(`L${i + 1} ${level.name}: FAIL — unsolvable`);
    failed++;
  } else {
    console.log(
      `L${i + 1} ${level.name}: ok, ${result.mirrors}/${level.tray.length} mirrors  ${result.layout.join(' ')}`,
    );
  }
});
process.exit(failed ? 1 : 0);
