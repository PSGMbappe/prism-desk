/**
 * Search random layouts for a level that the solver proves needs exactly
 * `minMirrors` mirrors. Usage: node scripts/gen-level.ts cols rows gems blocks fixed tray minMirrors seed
 */
import { cellKey, isOpenCell, traceBeam, type Level, type MirrorKind, type Dir } from '../src/puzzle.ts';

const [cols, rows, nGems, nBlocks, nFixed, nTray, minM, seed0] = process.argv.slice(2).map(Number);
let seed = seed0 || 1;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];

function rim(): { c: number; r: number; inward: Dir } {
  const side = Math.floor(rnd() * 4);
  if (side === 0) return { c: -1, r: Math.floor(rnd() * rows), inward: { dc: 1, dr: 0 } };
  if (side === 1) return { c: cols, r: Math.floor(rnd() * rows), inward: { dc: -1, dr: 0 } };
  if (side === 2) return { c: Math.floor(rnd() * cols), r: -1, inward: { dc: 0, dr: 1 } };
  return { c: Math.floor(rnd() * cols), r: rows, inward: { dc: 0, dr: -1 } };
}

function solveMin(level: Level): number {
  const open: string[] = [];
  for (let c = 0; c < level.cols; c++) for (let r = 0; r < level.rows; r++) if (isOpenCell(level, c, r)) open.push(cellKey(c, r));
  const s0 = level.tray.filter((k) => k === '/').length, b0 = level.tray.length - s0;
  let best = Infinity; let count = 0;
  const placed = new Map<string, MirrorKind>();
  const dfs = (i: number, s: number, b: number) => {
    if (placed.size > best) return;
    if (traceBeam(level, placed).solved) { if (placed.size < best) { best = placed.size; count = 1; } else count++; return; }
    if (i >= open.length) return;
    if (s > 0) { placed.set(open[i], '/'); dfs(i + 1, s - 1, b); placed.delete(open[i]); }
    if (b > 0) { placed.set(open[i], '\\'); dfs(i + 1, s, b - 1); placed.delete(open[i]); }
    dfs(i + 1, s, b);
  };
  dfs(0, s0, b0);
  return best === Infinity ? -1 : best * 1000 + Math.min(count, 999);
}

for (let attempt = 0; attempt < 20000; attempt++) {
  const e = rim(); const rc = rim();
  if (e.c === rc.c && e.r === rc.r) continue;
  const used = new Set<string>();
  const cell = () => { for (;;) { const c = Math.floor(rnd() * cols), r = Math.floor(rnd() * rows); const k = cellKey(c, r); if (!used.has(k)) { used.add(k); return { c, r }; } } };
  const gems = Array.from({ length: nGems }, cell);
  const blocks = Array.from({ length: nBlocks }, cell);
  const fixed = Array.from({ length: nFixed }, () => ({ ...cell(), kind: pick<MirrorKind>(['/', '\\']) }));
  const tray = Array.from({ length: nTray }, (_, i) => (i % 2 ? '\\' : '/') as MirrorKind);
  const level: Level = { name: '', hint: '', cols, rows, emitter: { c: e.c, r: e.r, dir: e.inward }, receiver: { c: rc.c, r: rc.r }, gems, blocks, fixed, tray };
  if (traceBeam(level, new Map()).solved) continue;
  const res = solveMin(level);
  if (res < 0) continue;
  const m = Math.floor(res / 1000), solutions = res % 1000;
  if (m >= minM && solutions <= 20) {
    console.log(JSON.stringify({ emitter: level.emitter, receiver: level.receiver, gems, blocks, fixed, tray, minMirrors: m, solutions }));
    process.exit(0);
  }
}
console.log('none found');
