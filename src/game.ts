/**
 * Prism Desk game system: puts the board on the player's real table, spawns
 * mirror tiles, snaps them to the grid when released, traces the light beam
 * and runs the level flow.
 */
import {
  AdditiveBlending,
  Box3,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  createSystem,
  type Entity,
  Grabbed,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  OctahedronGeometry,
  OneHandGrabbable,
  Points,
  PointsMaterial,
  PokeInteractable,
  Pressed,
  RayInteractable,
  RingGeometry,
  TorusGeometry,
  Vector3,
  VisibilityState,
  XRPlane,
} from '@iwsdk/core';
import { BoardHandle, DeskButton, MirrorTile } from './game-components.js';
import { Label } from './label.js';
import {
  cellKey,
  isOpenCell,
  type Level,
  LEVELS,
  type MirrorKind,
  traceBeam,
  type TraceResult,
} from './puzzle.js';
import { sfx } from './sfx.js';

/** Grid cell size in metres. */
const S = 0.065;
const TILE = 0.054;
/** Centre-to-centre spacing of tray tiles, wide enough that a hand reaching
 *  for one tile never closes on its neighbour. */
const TRAY_GAP = 0.095;
const BEAM_Y = 0.024;
const MAX_BEAM_SEGMENTS = 24;
const MAX_FLARES = 16;
const SPARKS = 90;
const PROGRESS_KEY = 'prism-desk-level';

const KINDS: MirrorKind[] = ['/', '\\'];

export class GameSystem extends createSystem({
  tiles: { required: [MirrorTile] },
  buttons: { required: [DeskButton] },
  pressedButtons: { required: [DeskButton, Pressed] },
  handle: { required: [BoardHandle] },
  planes: { required: [XRPlane] },
}) {
  // Scene graph
  private root!: Group;
  private rootEntity!: Entity;
  private levelGroup!: Group;
  private handleEntity!: Entity;
  private handleOffset = new Vector3(0, 0.012, 0);
  private label!: Label;
  private slabGeometry: BoxGeometry | null = null;

  // Shared resources (built once, reused across levels)
  private mats!: Record<string, MeshStandardMaterial | MeshBasicMaterial>;
  private geos!: Record<string, BoxGeometry | CylinderGeometry | OctahedronGeometry | RingGeometry | TorusGeometry>;
  private beamPool: Mesh[] = [];
  private flarePool: Mesh[] = [];
  private flareCount = 0;
  private highlight!: Mesh;
  private teachMarker!: Mesh;

  // Solve celebration: a burst of sparks from the receiver.
  private sparks!: Points;
  private sparkPos!: Float32Array;
  private sparkVel!: Float32Array;
  private sparkStart = -1;
  private solveTime = -1;

  // Flow and feedback
  private mode: 'title' | 'play' = 'title';
  private paused = false;
  private solveMirrors = 0;
  private now = 0;
  private popTimes = new Map<Entity, number>();

  // Pinch grabbing for tiles. The SDK's near grab measures from the palm,
  // which picks the neighbouring tile when a hand reaches across the tray, so
  // tiles are grabbed from the true pinch point (between thumb and index tip).
  private held: Record<'left' | 'right', Entity | null> = { left: null, right: null };
  private heldOffset = { left: new Vector3(), right: new Vector3() };
  private pinch = new Vector3();

  // Level state
  private levelIndex = 0;
  private level!: Level;
  private placed = new Map<string, MirrorKind>();
  private trace!: TraceResult;
  private solved = false;
  private gemMeshes = new Map<string, Mesh>();
  private receiverMesh!: Mesh;
  private levelEntities: Entity[] = [];
  private nextButton: Entity | null = null;
  private tileTargets = new Map<Entity, Vector3>();
  private litGemsLast = 0;

  // Placement
  private placementDeadline = -1;
  private placedOnTable = false;

  // Scratch (no per-frame allocation)
  private v1 = new Vector3();
  private v2 = new Vector3();
  private v3 = new Vector3();
  private box = new Box3();
  private slabBox = new Box3();
  private slab: Mesh | null = null;

  init(): void {
    this.buildSharedResources();

    this.root = new Group();
    this.root.name = 'Prism Board';
    this.rootEntity = this.world.createTransformEntity(this.root);
    this.levelGroup = new Group();
    this.root.add(this.levelGroup);

    // Default desk position for the flat browser preview.
    this.root.position.set(0, 0.72, -0.42);

    this.label = new Label(0.4, 0.085);
    this.root.add(this.label.mesh);

    for (let i = 0; i < MAX_BEAM_SEGMENTS; i++) {
      const m = new Mesh(this.geos.beam, this.mats.beam);
      m.visible = false;
      m.renderOrder = 5;
      // Soft outer glow; inherits the core's length via scale.x.
      const glow = new Mesh(this.geos.beamGlow, this.mats.beamGlow);
      glow.renderOrder = 4;
      m.add(glow);
      this.root.add(m);
      this.beamPool.push(m);
    }
    for (let i = 0; i < MAX_FLARES; i++) {
      const f = new Mesh(this.geos.flare, this.mats.flare);
      f.visible = false;
      f.renderOrder = 6;
      this.root.add(f);
      this.flarePool.push(f);
    }

    this.sparkPos = new Float32Array(SPARKS * 3);
    this.sparkVel = new Float32Array(SPARKS * 3);
    const sparkGeo = new BufferGeometry();
    sparkGeo.setAttribute('position', new BufferAttribute(this.sparkPos, 3));
    this.sparks = new Points(
      sparkGeo,
      new PointsMaterial({
        color: 0xb6ffde,
        size: 0.009,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.sparks.frustumCulled = false;
    this.sparks.visible = false;
    this.root.add(this.sparks);
    this.highlight = new Mesh(this.geos.ring, this.mats.highlight);
    this.highlight.rotation.x = -Math.PI / 2;
    this.highlight.visible = false;
    this.root.add(this.highlight);
    this.teachMarker = new Mesh(this.geos.ring, this.mats.teach);
    this.teachMarker.rotation.x = -Math.PI / 2;
    this.teachMarker.visible = false;
    this.root.add(this.teachMarker);

    this.createHandle();

    this.showTitle();

    this.queries.pressedButtons.subscribe('qualify', (e) =>
      this.onButton(e.getValue(DeskButton, 'action') as string),
    );

    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((state) => {
        if (state === VisibilityState.Visible && !this.placedOnTable) {
          sfx.unlock();
          // Wait for the session's first frames, then place in front of the
          // player and keep looking for a real table for a few seconds.
          this.placementDeadline = -2;
        }
        if (state === VisibilityState.NonImmersive) {
          this.placedOnTable = false;
          this.placementDeadline = -1;
        }
        // Headset off or system menu open: say so, and resume where we were.
        this.paused = state === VisibilityState.VisibleBlurred;
        this.refreshLabel();
      }),
    );
  }

  // ---------------------------------------------------------------- build

  private buildSharedResources(): void {
    const std = (color: number, extra: Partial<MeshStandardMaterial> = {}) => {
      const m = new MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.1 });
      Object.assign(m, extra);
      return m;
    };
    this.mats = {
      board: std(0x1b2233, { roughness: 0.8 }),
      cell: std(0x2a3550, { roughness: 0.7 }),
      tile: std(0xe9edf5, { roughness: 0.35 }),
      fixedTile: std(0x7d8596, { roughness: 0.5 }),
      mirror: std(0xbfefff, {
        metalness: 0.9,
        roughness: 0.08,
        emissive: new Color(0x2a6f86),
        emissiveIntensity: 0.6,
      }),
      rock: std(0x5a4a3f, { roughness: 0.95 }),
      emitter: std(0xffc857, { emissive: new Color(0xff9d00), emissiveIntensity: 0.8 }),
      gem: std(0xb388ff, { emissive: new Color(0x3b1f7a), emissiveIntensity: 0.5, roughness: 0.2 }),
      gemLit: std(0xe6d6ff, { emissive: new Color(0xb388ff), emissiveIntensity: 2.2, roughness: 0.2 }),
      receiver: std(0x3ddc97, { emissive: new Color(0x0c5c3a), emissiveIntensity: 0.5 }),
      receiverLit: std(0xb6ffde, { emissive: new Color(0x3ddc97), emissiveIntensity: 2.5 }),
      handle: std(0x45506a, { roughness: 0.6 }),
      button: std(0x7fe8ff, { emissive: new Color(0x1b6f86), emissiveIntensity: 0.7 }),
      buttonAlt: std(0xffc857, { emissive: new Color(0x80580a), emissiveIntensity: 0.6 }),
      beam: new MeshBasicMaterial({
        color: 0xffe9a8,
        transparent: true,
        opacity: 0.9,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
      beamGlow: new MeshBasicMaterial({
        color: 0xffb347,
        transparent: true,
        opacity: 0.22,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
      flare: new MeshBasicMaterial({
        color: 0xfff3c4,
        transparent: true,
        opacity: 0.8,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
      tileHeld: std(0xf4fbff, { emissive: new Color(0x3fc8ff), emissiveIntensity: 0.9, roughness: 0.3 }),
      highlight: new MeshBasicMaterial({ color: 0x7fffb0, transparent: true, opacity: 0.85, depthWrite: false }),
      teach: new MeshBasicMaterial({ color: 0x7fe8ff, transparent: true, opacity: 0.8, depthWrite: false }),
    };
    this.geos = {
      cell: new BoxGeometry(S * 0.92, 0.004, S * 0.92),
      tileBase: new BoxGeometry(TILE, 0.01, TILE),
      mirrorPane: new BoxGeometry(TILE * 1.25, 0.034, 0.005),
      rock: new BoxGeometry(S * 0.8, 0.05, S * 0.8),
      emitter: new BoxGeometry(S * 0.7, 0.04, S * 0.7),
      nozzle: new CylinderGeometry(0.009, 0.009, S * 0.5, 12),
      gem: new OctahedronGeometry(0.017, 0),
      receiver: new TorusGeometry(0.019, 0.007, 10, 24),
      beam: new BoxGeometry(1, 0.006, 0.006),
      beamGlow: new BoxGeometry(1, 0.018, 0.018),
      flare: new OctahedronGeometry(0.011, 1),
      ring: new RingGeometry(S * 0.36, S * 0.46, 32),
      handle: new CylinderGeometry(0.012, 0.012, 0.12, 16),
      button: new CylinderGeometry(0.018, 0.02, 0.014, 24),
    };
  }

  private createHandle(): void {
    const handleMesh = new Mesh(this.geos.handle, this.mats.handle);
    handleMesh.rotation.z = Math.PI / 2;
    const holder = new Group();
    holder.name = 'Board Handle';
    holder.add(handleMesh);
    this.handleEntity = this.world.createTransformEntity(holder);
    this.handleEntity.addComponent(BoardHandle);
    this.handleEntity.addComponent(OneHandGrabbable, { rotate: false, translate: true });
  }

  // --------------------------------------------------------------- levels

  private cellPos(c: number, r: number, y: number, out: Vector3): Vector3 {
    return out.set(
      (c - (this.level.cols - 1) / 2) * S,
      y,
      (r - (this.level.rows - 1) / 2) * S,
    );
  }

  private trayPos(slot: number, out: Vector3): Vector3 {
    const n = this.level.tray.length;
    return out.set(
      (slot - (n - 1) / 2) * (TRAY_GAP),
      0.008,
      (this.level.rows / 2 + 1) * S + 0.055,
    );
  }

  private addMesh(geo: keyof GameSystem['geos'], mat: string, parent: Object3D = this.levelGroup): Mesh {
    const m = new Mesh(this.geos[geo as string], this.mats[mat]);
    parent.add(m);
    return m;
  }

  private clearLevel(): void {
    for (const e of this.levelEntities) {
      if (e.active) e.dispose({ disposeResources: false });
    }
    this.levelEntities = [];
    this.held.left = null;
    this.held.right = null;
    this.nextButton = null;
    this.tileTargets.clear();
    this.gemMeshes.clear();
    for (const child of [...this.levelGroup.children]) child.removeFromParent();
    this.placed.clear();
  }

  private savedLevel(): number {
    let saved = 0;
    try {
      saved = Number(localStorage.getItem(PROGRESS_KEY) ?? 0) || 0;
    } catch {
      saved = 0;
    }
    return Math.min(Math.max(saved, 0), LEVELS.length - 1);
  }

  /** Title card: the next level's board as a preview, plus a Start button. */
  private showTitle(): void {
    this.mode = 'title';
    this.loadLevel(this.savedLevel(), true);
  }

  private loadLevel(index: number, title = false): void {
    this.clearLevel();
    this.mode = title ? 'title' : 'play';
    this.levelIndex = index;
    this.solveTime = -1;
    this.sparks.visible = false;
    this.level = LEVELS[index];
    this.solved = false;
    this.litGemsLast = 0;
    const L = this.level;
    const w = (L.cols + 2) * S;
    const d = (L.rows + 2) * S;

    // Board slab under the rim, grid and tray.
    const front = (L.rows / 2 + 1) * S + 0.055 + TILE / 2 + 0.02;
    const back = -d / 2 - 0.01;
    const slabW = Math.max(w, L.tray.length * (TRAY_GAP)) + 0.02;
    const slab = new Mesh(new BoxGeometry(slabW, 0.012, front - back), this.mats.board);
    slab.position.set(0, -0.006, (front + back) / 2);
    this.levelGroup.add(slab);
    this.slab = slab;
    this.slabGeometry?.dispose();
    this.slabGeometry = slab.geometry;

    for (let c = 0; c < L.cols; c++) {
      for (let r = 0; r < L.rows; r++) {
        const cell = this.addMesh('cell', 'cell');
        this.cellPos(c, r, 0.002, cell.position);
      }
    }
    for (const b of L.blocks) {
      const rock = this.addMesh('rock', 'rock');
      this.cellPos(b.c, b.r, 0.025, rock.position);
      rock.rotation.y = ((b.c * 7 + b.r * 3) % 5) * 0.2;
    }
    for (const g of L.gems) {
      const gem = this.addMesh('gem', 'gem');
      this.cellPos(g.c, g.r, BEAM_Y, gem.position);
      this.gemMeshes.set(cellKey(g.c, g.r), gem);
    }
    for (const f of L.fixed) {
      const t = this.buildTileVisual(f.kind, true);
      this.cellPos(f.c, f.r, 0.005, t.position);
      this.levelGroup.add(t);
    }

    // Emitter on the rim, facing into the grid.
    const em = this.addMesh('emitter', 'emitter');
    this.cellPos(L.emitter.c, L.emitter.r, 0.02, em.position);
    const nozzle = this.addMesh('nozzle', 'emitter', em);
    nozzle.position.set(L.emitter.dir.dc * S * 0.4, 0.004, L.emitter.dir.dr * S * 0.4);
    nozzle.rotation.set(L.emitter.dir.dr !== 0 ? Math.PI / 2 : 0, 0, L.emitter.dir.dc !== 0 ? Math.PI / 2 : 0);

    // Receiver ring standing on the rim, facing the grid.
    this.receiverMesh = this.addMesh('receiver', 'receiver');
    this.cellPos(L.receiver.c, L.receiver.r, BEAM_Y, this.receiverMesh.position);
    const horizontal = L.receiver.c < 0 || L.receiver.c >= L.cols;
    this.receiverMesh.rotation.y = horizontal ? Math.PI / 2 : 0;

    const bx = slabW / 2 + 0.04;
    const tz = this.trayPos(0, this.v1).z;
    if (title) {
      const start = this.createButton('start', 'Start', 0, tz, 'button');
      start.object3D!.scale.setScalar(1.6);
      this.levelEntities.push(start);
    }

    // Tray tiles the player can pick up.
    if (!title) L.tray.forEach((kind, slot) => {
      const visual = this.buildTileVisual(kind, false);
      visual.name = `Mirror ${kind === '/' ? 'Slash' : 'Backslash'} ${slot + 1}`;
      this.trayPos(slot, visual.position);
      const entity = this.world.createTransformEntity(visual, { parent: this.rootEntity });
      entity.addComponent(MirrorTile, { kind: KINDS.indexOf(kind), slot, cellC: -1, cellR: -1 });
      this.tileTargets.set(entity, visual.position.clone());
      this.levelEntities.push(entity);
    });

    // Reset sits right of the tray, Next on the far left, so a finger
    // reaching for one never sweeps through the other.
    if (!title) {
      this.levelEntities.push(this.createButton('reset', 'Reset', bx, tz, 'buttonAlt'));
      this.nextButton = this.createButton(
        'next',
        index === LEVELS.length - 1 ? 'Again' : 'Next',
        -bx,
        tz,
        'button',
      );
      this.nextButton.object3D!.visible = false;
      this.levelEntities.push(this.nextButton);
    }

    // Status label floats behind the far edge, facing the player.
    this.label.mesh.position.set(0, 0.075, -d / 2 - 0.01);
    this.label.mesh.rotation.x = -0.25;
    this.refreshLabel();

    if (L.teach && !title) {
      this.cellPos(L.teach.c, L.teach.r, 0.006, this.teachMarker.position);
      this.teachMarker.visible = true;
    } else {
      this.teachMarker.visible = false;
    }

    this.positionHandle();
    this.retrace();
  }

  private buildTileVisual(kind: MirrorKind, fixed: boolean): Group {
    const g = new Group();
    const base = new Mesh(this.geos.tileBase, fixed ? this.mats.fixedTile : this.mats.tile);
    base.position.y = 0.005;
    const pane = new Mesh(this.geos.mirrorPane, this.mats.mirror);
    pane.position.y = 0.027;
    pane.rotation.y = kind === '/' ? Math.PI / 4 : -Math.PI / 4;
    g.add(base, pane);
    return g;
  }

  private createButton(action: string, text: string, x: number, z: number, mat: string): Entity {
    const g = new Group();
    g.name = `${text} Button`;
    const cap = new Mesh(this.geos.button, this.mats[mat]);
    cap.position.y = 0.007;
    const label = new Label(0.07, 0.024, 256);
    label.set(text, '', mat === 'button' ? '#7fe8ff' : '#ffc857');
    label.mesh.position.set(0, 0.018, 0);
    label.mesh.rotation.x = -Math.PI / 2 + 0.6;
    g.add(cap, label.mesh);
    g.position.set(x, 0, z);
    const e = this.world.createTransformEntity(g, { parent: this.rootEntity });
    e.addComponent(DeskButton, { action });
    e.addComponent(PokeInteractable);
    e.addComponent(RayInteractable);
    return e;
  }

  // ---------------------------------------------------------- interaction

  /** World-space pinch point of a hand (or grip of a controller). */
  private pinchPoint(hand: 'left' | 'right', out: Vector3): boolean {
    const session = this.xrManager.getSession();
    const frame = this.xrFrame;
    const ref = this.xrManager.getReferenceSpace();
    if (session && frame && ref) {
      for (const src of session.inputSources) {
        if (src.handedness !== hand || !src.hand || !frame.getJointPose) continue;
        const thumb = src.hand.get('thumb-tip');
        const index = src.hand.get('index-finger-tip');
        const a = thumb && frame.getJointPose(thumb, ref);
        const b = index && frame.getJointPose(index, ref);
        if (a && b) {
          out.set(
            (a.transform.position.x + b.transform.position.x) / 2,
            (a.transform.position.y + b.transform.position.y) / 2,
            (a.transform.position.z + b.transform.position.z) / 2,
          );
          this.player.localToWorld(out);
          return true;
        }
      }
    }
    this.player.gripSpaces[hand].getWorldPosition(out);
    return true;
  }

  private isHeld(e: Entity): boolean {
    return this.held.left === e || this.held.right === e;
  }

  private tryGrab(hand: 'left' | 'right'): void {
    if (this.mode !== 'play' || !this.pinchPoint(hand, this.pinch)) return;
    let best: Entity | null = null;
    let bestDist = 0.065; // must pinch within 6.5 cm of a tile
    for (const e of this.queries.tiles.entities) {
      const obj = e.object3D;
      if (!obj || this.isHeld(e)) continue;
      obj.getWorldPosition(this.v1);
      this.v1.y += 0.02; // tile centre, not its base
      const d = this.v1.distanceTo(this.pinch);
      if (d < bestDist) {
        bestDist = d;
        best = e;
      }
    }
    if (!best?.object3D) return;
    this.held[hand] = best;
    this.root.worldToLocal(this.v2.copy(this.pinch));
    this.heldOffset[hand].copy(best.object3D.position).sub(this.v2);
    this.onPick(best);
  }

  private release(hand: 'left' | 'right'): void {
    const e = this.held[hand];
    if (!e) return;
    this.held[hand] = null;
    this.onDrop(e);
  }

  private onPick(e: Entity): void {
    sfx.unlock();
    const c = e.getValue(MirrorTile, 'cellC') as number;
    const r = e.getValue(MirrorTile, 'cellR') as number;
    if (c >= 0) {
      this.placed.delete(cellKey(c, r));
      e.setValue(MirrorTile, 'cellC', -1);
      e.setValue(MirrorTile, 'cellR', -1);
      this.retrace();
    }
    this.setTileBase(e, this.mats.tileHeld);
    sfx.pick();
  }

  private setTileBase(e: Entity, mat: MeshStandardMaterial | MeshBasicMaterial): void {
    const base = e.object3D?.children[0] as Mesh | undefined;
    if (base) base.material = mat;
  }

  /** Nearest open cell under a tile, or null if it is not over the grid. */
  private dropCell(obj: Object3D, out: { c: number; r: number }): boolean {
    obj.getWorldPosition(this.v1);
    this.root.worldToLocal(this.v1);
    if (this.v1.y > 0.12 || this.v1.y < -0.05) return false;
    const fc = this.v1.x / S + (this.level.cols - 1) / 2;
    const fr = this.v1.z / S + (this.level.rows - 1) / 2;
    const c = Math.round(fc);
    const r = Math.round(fr);
    if (Math.abs(fc - c) > 0.75 || Math.abs(fr - r) > 0.75) return false;
    if (!isOpenCell(this.level, c, r) || this.placed.has(cellKey(c, r))) return false;
    out.c = c;
    out.r = r;
    return true;
  }

  private dropTmp = { c: 0, r: 0 };

  private onDrop(e: Entity): void {
    const obj = e.object3D;
    if (!obj || !e.active) return;
    // Put the tile back under the board in case grabbing re-parented it.
    if (obj.parent !== this.root) this.root.attach(obj);
    obj.rotation.set(0, 0, 0);
    this.setTileBase(e, this.mats.tile);
    const target = this.tileTargets.get(e);
    if (!target) return;
    if (this.dropCell(obj, this.dropTmp)) {
      const { c, r } = this.dropTmp;
      const kind = KINDS[e.getValue(MirrorTile, 'kind') as number];
      this.placed.set(cellKey(c, r), kind);
      e.setValue(MirrorTile, 'cellC', c);
      e.setValue(MirrorTile, 'cellR', r);
      this.cellPos(c, r, 0.005, target);
      sfx.place();
      this.popTimes.set(e, this.now);
      if (this.level.teach) this.teachMarker.visible = false;
      this.retrace();
    } else {
      this.trayPos(e.getValue(MirrorTile, 'slot') as number, target);
      sfx.reject();
    }
  }

  private onButton(action: string): void {
    sfx.button();
    if (action === 'start') {
      sfx.unlock();
      this.loadLevel(this.levelIndex);
    } else if (action === 'reset') {
      this.loadLevel(this.levelIndex);
    } else if (action === 'next' && this.solved) {
      this.loadLevel((this.levelIndex + 1) % LEVELS.length);
    }
  }

  // ----------------------------------------------------------------- beam

  private retrace(): void {
    this.trace = traceBeam(this.level, this.placed);
    const { path } = this.trace;

    // Merge straight runs into single segments.
    let seg = 0;
    let start = 0;
    for (let i = 1; i < path.length && seg < MAX_BEAM_SEGMENTS; i++) {
      const last = i === path.length - 1;
      const turn =
        !last &&
        (path[i + 1].c - path[i].c !== path[i].c - path[i - 1].c ||
          path[i + 1].r - path[i].r !== path[i].r - path[i - 1].r);
      if (turn || last) {
        this.cellPos(path[start].c, path[start].r, BEAM_Y, this.v1);
        this.cellPos(path[i].c, path[i].r, BEAM_Y, this.v2);
        const m = this.beamPool[seg++];
        m.position.addVectors(this.v1, this.v2).multiplyScalar(0.5);
        m.scale.set(this.v1.distanceTo(this.v2) + 0.006, 1, 1);
        m.rotation.set(0, -Math.atan2(this.v2.z - this.v1.z, this.v2.x - this.v1.x), 0);
        m.visible = true;
        start = i;
      }
    }
    for (let i = seg; i < MAX_BEAM_SEGMENTS; i++) this.beamPool[i].visible = false;

    // Flares where the beam leaves the emitter and wherever it bends.
    let f = 0;
    for (let i = 0; i < path.length - 1 && f < MAX_FLARES; i++) {
      const bend =
        i === 0 ||
        path[i + 1].c - path[i].c !== path[i].c - path[i - 1].c ||
        path[i + 1].r - path[i].r !== path[i].r - path[i - 1].r;
      if (!bend) continue;
      const flare = this.flarePool[f++];
      this.cellPos(path[i].c, path[i].r, BEAM_Y, flare.position);
      if (i === 0) {
        flare.position.x += this.level.emitter.dir.dc * S * 0.62;
        flare.position.z += this.level.emitter.dir.dr * S * 0.62;
      }
      flare.visible = true;
    }
    this.flareCount = f;
    for (let i = f; i < MAX_FLARES; i++) this.flarePool[i].visible = false;

    // Gems and receiver glow.
    const lit = new Set<string>();
    for (const p of path) lit.add(cellKey(p.c, p.r));
    for (const [key, mesh] of this.gemMeshes) {
      mesh.material = lit.has(key) ? this.mats.gemLit : this.mats.gem;
    }
    if (this.trace.litGems > this.litGemsLast) sfx.gem();
    this.litGemsLast = this.trace.litGems;
    this.receiverMesh.material = this.trace.solved ? this.mats.receiverLit : this.mats.receiver;

    if (this.trace.solved && !this.solved && this.mode === 'play') {
      this.solved = true;
      this.solveMirrors = this.placed.size;
      this.solveTime = this.now;
      this.burstSparks();
      sfx.solved();
      if (this.nextButton?.object3D) this.nextButton.object3D.visible = true;
      const last = this.levelIndex === LEVELS.length - 1;
      try {
        localStorage.setItem(PROGRESS_KEY, String(last ? 0 : this.levelIndex + 1));
      } catch {
        /* storage unavailable */
      }
    } else if (!this.trace.solved && this.solved) {
      this.solved = false;
      this.solveTime = -1;
      if (this.nextButton?.object3D) this.nextButton.object3D.visible = false;
    }
    this.refreshLabel();
  }

  /** One place decides what the floating label says. */
  private refreshLabel(): void {
    if (!this.level) return;
    const L = this.level;
    const n = this.levelIndex + 1;
    if (this.paused) {
      this.label.set('Paused', 'Your puzzle is waiting right where you left it', '#ffc857');
    } else if (this.mode === 'title') {
      this.label.set(
        'PRISM DESK',
        n === 1 ? 'Bend light with your hands · Poke Start' : `Continue at level ${n} of ${LEVELS.length} · Poke Start`,
        '#ffc857',
      );
    } else if (this.solved) {
      const last = this.levelIndex === LEVELS.length - 1;
      const perfect = this.solveMirrors <= L.par;
      const next = last ? 'Poke Again to replay' : 'Poke Next';
      this.label.set(
        last ? 'You mastered every prism!' : perfect ? 'Perfect! ★' : 'Solved!',
        perfect
          ? `Fewest mirrors possible · ${next}`
          : `${this.solveMirrors} mirrors · can you do it with ${L.par}? · ${next}`,
        '#3ddc97',
      );
    } else {
      this.label.set(`${n}/${LEVELS.length} · ${L.name}`, L.hint);
    }
  }

  private burstSparks(): void {
    const origin = this.receiverMesh.position;
    for (let i = 0; i < SPARKS; i++) {
      const a = Math.random() * Math.PI * 2;
      const up = 0.25 + Math.random() * 0.45;
      const speed = 0.12 + Math.random() * 0.22;
      this.sparkPos[i * 3] = origin.x;
      this.sparkPos[i * 3 + 1] = origin.y;
      this.sparkPos[i * 3 + 2] = origin.z;
      this.sparkVel[i * 3] = Math.cos(a) * speed * (1 - up);
      this.sparkVel[i * 3 + 1] = up * 0.9;
      this.sparkVel[i * 3 + 2] = Math.sin(a) * speed * (1 - up);
    }
    this.sparks.geometry.attributes.position.needsUpdate = true;
    this.sparks.visible = true;
    this.sparkStart = this.now;
  }

  // ------------------------------------------------------------ placement

  private positionHandle(): void {
    const obj = this.handleEntity.object3D;
    if (!obj) return;
    const d = (this.level.rows + 2) * S;
    this.handleOffset.set(0, 0.012, -d / 2 - 0.045);
    obj.position.copy(this.handleOffset).applyQuaternion(this.root.quaternion).add(this.root.position);
    obj.quaternion.copy(this.root.quaternion);
  }

  /** Place the board in front of the player at seated desk height. */
  private placeInFrontOfPlayer(): void {
    const head = this.player.head;
    head.getWorldPosition(this.v1);
    head.getWorldDirection(this.v2); // camera looks down -Z; this is +Z of the head
    this.v2.negate();
    this.v2.y = 0;
    if (this.v2.lengthSq() < 1e-4) this.v2.set(0, 0, -1);
    this.v2.normalize();
    this.root.position.copy(this.v1).addScaledVector(this.v2, 0.42);
    this.root.position.y = this.v1.y - 0.42;
    this.faceHead();
  }

  private faceHead(): void {
    this.player.head.getWorldPosition(this.v1);
    const dx = this.v1.x - this.root.position.x;
    const dz = this.v1.z - this.root.position.z;
    this.root.rotation.set(0, Math.atan2(dx, dz), 0);
  }

  /** Snap the board onto a detected table, if the room scan has one. */
  private tryPlaceOnTable(): boolean {
    this.player.head.getWorldPosition(this.v3);
    let best: Mesh | null = null;
    let bestScore = Infinity;
    for (const e of this.queries.planes.entities) {
      const plane = e.getValue(XRPlane, '_plane') as
        | { orientation?: string; semanticLabel?: string }
        | undefined;
      const mesh = e.object3D as Mesh | undefined;
      if (!plane || !mesh || plane.orientation !== 'horizontal') continue;
      mesh.getWorldPosition(this.v1);
      const below = this.v3.y - this.v1.y;
      const label = plane.semanticLabel ?? '';
      const isTable = label === 'table' || label === 'desk';
      if (!isTable && (below < 0.2 || below > 0.9)) continue; // not desk height
      const dist = Math.hypot(this.v1.x - this.v3.x, this.v1.z - this.v3.z);
      if (dist > 1.6) continue;
      const score = dist - (isTable ? 1 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = mesh;
      }
    }
    if (!best) return false;
    this.box.setFromObject(best);
    const p = this.root.position;
    p.x = Math.min(Math.max(p.x, this.box.min.x), this.box.max.x);
    p.z = Math.min(Math.max(p.z, this.box.min.z), this.box.max.z);
    p.y = this.box.max.y + 0.002;
    this.faceHead();
    // Shift so the whole board footprint rests on the table where it fits;
    // centre it on any axis where the table is smaller than the board.
    if (this.slab) {
      this.root.updateMatrixWorld(true);
      this.slabBox.setFromObject(this.slab);
      for (const axis of ['x', 'z'] as const) {
        const tMin = this.box.min[axis];
        const tMax = this.box.max[axis];
        const bMin = this.slabBox.min[axis];
        const bMax = this.slabBox.max[axis];
        if (bMax - bMin > tMax - tMin) p[axis] += (tMin + tMax) / 2 - (bMin + bMax) / 2;
        else if (bMin < tMin) p[axis] += tMin - bMin;
        else if (bMax > tMax) p[axis] -= bMax - tMax;
      }
      this.faceHead();
    }
    return true;
  }

  update(delta: number, time: number): void {
    this.now = time;
    // Board placement when entering mixed reality.
    if (this.placementDeadline === -2) {
      this.placeInFrontOfPlayer();
      this.placementDeadline = time + 4;
      this.positionHandle();
    } else if (this.placementDeadline > 0) {
      if (this.tryPlaceOnTable()) {
        this.placedOnTable = true;
        this.placementDeadline = -1;
        this.positionHandle();
      } else if (time > this.placementDeadline) {
        this.placedOnTable = true; // keep the fallback spot
        this.placementDeadline = -1;
      }
    }

    // Moving the board by its handle.
    const handleObj = this.handleEntity.object3D;
    if (handleObj) {
      if (this.handleEntity.hasComponent(Grabbed)) {
        this.v1.copy(this.handleOffset).applyQuaternion(this.root.quaternion);
        handleObj.getWorldPosition(this.v2);
        this.root.position.copy(this.v2).sub(this.v1);
        this.faceHead();
      } else {
        this.positionHandle();
      }
    }

    // Pinch to pick up, follow the pinch point, release to drop.
    for (const hand of ['left', 'right'] as const) {
      const select = this.input.xr.getSelectState(hand);
      if (select.start) this.tryGrab(hand);
      const e = this.held[hand];
      if (e?.object3D && e.active && this.pinchPoint(hand, this.pinch)) {
        this.root.worldToLocal(this.pinch);
        e.object3D.position.copy(this.pinch).add(this.heldOffset[hand]);
      }
      if (select.end || (e && !select.active)) this.release(hand);
    }

    // Ease tiles toward their resting spot; preview the drop cell.
    let showHighlight = false;
    for (const e of this.queries.tiles.entities) {
      const obj = e.object3D;
      if (!obj) continue;
      if (this.isHeld(e)) {
        if (!showHighlight && this.dropCell(obj, this.dropTmp)) {
          this.cellPos(this.dropTmp.c, this.dropTmp.r, 0.007, this.highlight.position);
          showHighlight = true;
        }
        continue;
      }
      const target = this.tileTargets.get(e);
      if (target && obj.parent === this.root) obj.position.lerp(target, 0.25);
      // Little pop when a tile snaps into the grid.
      const popAt = this.popTimes.get(e);
      if (popAt !== undefined) {
        const t = time - popAt;
        if (t > 0.35) {
          obj.scale.setScalar(1);
          this.popTimes.delete(e);
        } else {
          obj.scale.setScalar(1 + 0.22 * Math.sin((t / 0.35) * Math.PI));
        }
      }
    }
    this.highlight.visible = showHighlight;

    // Gentle pulses.
    const pulse = 0.75 + 0.25 * Math.sin(time * 6);
    (this.mats.beam as MeshBasicMaterial).opacity = 0.7 + 0.25 * Math.sin(time * 10);
    (this.mats.teach as MeshBasicMaterial).opacity = 0.35 + 0.45 * pulse;
    for (const m of this.gemMeshes.values()) m.rotation.y = time * 1.2;
    for (let i = 0; i < this.flareCount; i++) {
      this.flarePool[i].scale.setScalar(0.8 + 0.35 * Math.sin(time * 9 + i * 1.7));
      this.flarePool[i].rotation.y = time * 2 + i;
    }
    if (this.solved) {
      this.receiverMesh.rotation.z = time * 2;
      const t = time - this.solveTime;
      this.receiverMesh.scale.setScalar(1 + 0.6 * Math.exp(-t * 4) + 0.06 * Math.sin(time * 5));
    } else if (this.receiverMesh) {
      this.receiverMesh.scale.setScalar(1);
    }

    // Spark burst: simple ballistic particles that fade out over 1.4 s.
    if (this.sparks.visible) {
      const t = time - this.sparkStart;
      if (t > 1.4) {
        this.sparks.visible = false;
      } else {
        const dt = Math.min(delta, 0.05);
        for (let i = 0; i < SPARKS; i++) {
          this.sparkVel[i * 3 + 1] -= 1.6 * dt;
          this.sparkPos[i * 3] += this.sparkVel[i * 3] * dt;
          this.sparkPos[i * 3 + 1] = Math.max(0.004, this.sparkPos[i * 3 + 1] + this.sparkVel[i * 3 + 1] * dt);
          this.sparkPos[i * 3 + 2] += this.sparkVel[i * 3 + 2] * dt;
        }
        this.sparks.geometry.attributes.position.needsUpdate = true;
        (this.sparks.material as PointsMaterial).opacity = Math.max(0, 1 - t / 1.4);
      }
    }
  }
}
