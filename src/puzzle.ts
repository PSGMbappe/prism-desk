/**
 * Pure puzzle model for Prism Desk: grid, levels and beam tracing.
 * No rendering or ECS imports, so it can be unit-tested in plain Node.
 *
 * Grid coordinates: column `c` grows to the player's right, row `r` grows
 * toward the player. Cells outside 0..cols-1 / 0..rows-1 are the board rim,
 * where emitters and receivers sit.
 */

export type MirrorKind = '/' | '\\';

export interface Cell {
  c: number;
  r: number;
}

export interface Dir {
  dc: number;
  dr: number;
}

export interface Level {
  name: string;
  hint: string;
  cols: number;
  rows: number;
  /** Emitter sits on the rim and fires in `dir`. */
  emitter: Cell & { dir: Dir };
  /** Receiver the beam must finally reach (usually on the rim). */
  receiver: Cell;
  /** Pass-through gems that must all be lit before the receiver counts. */
  gems: Cell[];
  /** Cells that stop the beam. */
  blocks: Cell[];
  /** Mirrors already on the board that the player cannot move. */
  fixed: (Cell & { kind: MirrorKind })[];
  /** Mirrors the player can pick up from the tray. */
  tray: MirrorKind[];
  /** Tutorial: a cell to highlight as the suggested drop spot. */
  teach?: Cell;
}

export const EAST: Dir = { dc: 1, dr: 0 };
export const WEST: Dir = { dc: -1, dr: 0 };
export const NORTH: Dir = { dc: 0, dr: -1 }; // away from the player
export const SOUTH: Dir = { dc: 0, dr: 1 }; // toward the player

export function reflect(kind: MirrorKind, d: Dir): Dir {
  // '/' runs from the near-left corner to the far-right corner (top view).
  return kind === '/' ? { dc: -d.dr, dr: -d.dc } : { dc: d.dr, dr: d.dc };
}

export const cellKey = (c: number, r: number): string => `${c},${r}`;

export interface TraceResult {
  /** Cell centres the beam passes through, starting at the emitter. */
  path: Cell[];
  litGems: number;
  reachedReceiver: boolean;
  solved: boolean;
}

/** Follow the beam from the emitter through the current mirror layout. */
export function traceBeam(
  level: Level,
  placed: ReadonlyMap<string, MirrorKind>,
): TraceResult {
  const mirrors = new Map<string, MirrorKind>(placed);
  for (const f of level.fixed) mirrors.set(cellKey(f.c, f.r), f.kind);
  const blocks = new Set(level.blocks.map((b) => cellKey(b.c, b.r)));
  const gems = new Set(level.gems.map((g) => cellKey(g.c, g.r)));
  const lit = new Set<string>();

  let { c, r } = level.emitter;
  let d = level.emitter.dir;
  const path: Cell[] = [{ c, r }];
  let reachedReceiver = false;
  const seen = new Set<string>();

  for (let step = 0; step < 200; step++) {
    c += d.dc;
    r += d.dr;
    path.push({ c, r });
    const key = cellKey(c, r);
    if (c === level.receiver.c && r === level.receiver.r) {
      reachedReceiver = true;
      break;
    }
    const inGrid = c >= 0 && c < level.cols && r >= 0 && r < level.rows;
    if (!inGrid || blocks.has(key)) break;
    if (gems.has(key)) lit.add(key);
    const m = mirrors.get(key);
    if (m) d = reflect(m, d);
    const state = `${key}:${d.dc},${d.dr}`;
    if (seen.has(state)) break; // beam loop guard
    seen.add(state);
  }

  return {
    path,
    litGems: lit.size,
    reachedReceiver,
    solved: reachedReceiver && lit.size === level.gems.length,
  };
}

/** True when a player mirror may be dropped on this cell. */
export function isOpenCell(level: Level, c: number, r: number): boolean {
  if (c < 0 || c >= level.cols || r < 0 || r >= level.rows) return false;
  const taken = [...level.blocks, ...level.gems, ...level.fixed];
  return !taken.some((t) => t.c === c && t.r === r);
}

export const LEVELS: Level[] = [
  {
    name: 'First Light',
    hint: 'Pinch the mirror below the board and drop it on the glowing square',
    cols: 3,
    rows: 3,
    emitter: { c: -1, r: 1, dir: EAST },
    receiver: { c: 1, r: -1 },
    gems: [],
    blocks: [],
    fixed: [],
    tray: ['/'],
    teach: { c: 1, r: 1 },
  },
  {
    name: 'Turn Toward You',
    hint: 'Mirrors lean two ways. Pick the one that bends light to the receiver',
    cols: 3,
    rows: 3,
    emitter: { c: -1, r: 0, dir: EAST },
    receiver: { c: 2, r: 3 },
    gems: [],
    blocks: [],
    fixed: [],
    tray: ['/', '\\'],
  },
  {
    name: 'Stairway',
    hint: 'Two bends. Rocks stop light',
    cols: 4,
    rows: 4,
    emitter: { c: -1, r: 3, dir: EAST },
    receiver: { c: 4, r: 0 },
    gems: [],
    blocks: [
      { c: 3, r: 1 },
      { c: 0, r: 1 },
      { c: 1, r: 1 },
    ],
    fixed: [],
    tray: ['/', '/'],
  },
  {
    name: 'Gem Hunt',
    hint: 'Light passes through gems. Light every gem, then hit the receiver',
    cols: 4,
    rows: 4,
    emitter: { c: -1, r: 0, dir: EAST },
    receiver: { c: -1, r: 3 },
    gems: [{ c: 3, r: 2 }],
    blocks: [{ c: 1, r: 2 }],
    fixed: [],
    tray: ['\\', '/', '\\'],
  },
  {
    name: 'Borrowed Mirror',
    hint: 'Grey mirrors are fixed. Work with them',
    cols: 5,
    rows: 4,
    emitter: { c: 1, r: -1, dir: SOUTH },
    receiver: { c: 4, r: -1 },
    gems: [{ c: 3, r: 2 }],
    blocks: [
      { c: 4, r: 3 },
      { c: 0, r: 3 },
    ],
    fixed: [{ c: 1, r: 0, kind: '\\' }],
    tray: ['/', '\\', '/', '\\'],
  },
  {
    name: 'Switchback',
    hint: 'Sometimes the long way round is the only way',
    cols: 5,
    rows: 5,
    emitter: { c: -1, r: 4, dir: EAST },
    receiver: { c: 5, r: 4 },
    gems: [
      { c: 1, r: 0 },
      { c: 3, r: 2 },
    ],
    blocks: [
      { c: 2, r: 4 },
      { c: 2, r: 1 },
    ],
    fixed: [],
    tray: ['/', '\\', '/', '\\', '/'],
  },
  {
    name: 'Crossroads',
    hint: 'A beam can cross its own path',
    cols: 5,
    rows: 5,
    emitter: { c: 5, r: 3, dir: WEST },
    receiver: { c: 3, r: -1 },
    gems: [
      { c: 3, r: 4 },
      { c: 2, r: 3 },
    ],
    blocks: [
      { c: 3, r: 2 },
      { c: 1, r: 1 },
      { c: 0, r: 4 },
    ],
    fixed: [{ c: 3, r: 1, kind: '/' }],
    tray: ['/', '\\', '/', '\\', '/'],
  },
  {
    name: 'Prism Master',
    hint: 'Every mirror counts. Take your time',
    cols: 6,
    rows: 5,
    emitter: { c: 6, r: 4, dir: WEST },
    receiver: { c: 6, r: 2 },
    gems: [
      { c: 2, r: 0 },
      { c: 1, r: 4 },
      { c: 1, r: 1 },
    ],
    blocks: [
      { c: 4, r: 0 },
      { c: 4, r: 1 },
      { c: 2, r: 2 },
    ],
    fixed: [{ c: 5, r: 3, kind: '/' }],
    tray: ['/', '\\', '/', '\\', '/', '\\'],
  },
];
