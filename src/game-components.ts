/**
 * Component declarations for Prism Desk. System-free on purpose: the editor
 * imports this module through src/components.ts.
 */
import { createComponent, Types } from '@iwsdk/core';

/** A mirror tile the player can pinch, carry and drop on the grid. */
export const MirrorTile = createComponent('MirrorTile', {
  /** 0 = '/', 1 = '\' */
  kind: { type: Types.Int8, default: 0 },
  /** Tray slot this tile returns to. */
  slot: { type: Types.Int32, default: 0 },
  /** Grid cell the tile sits on, or -1 while in the tray. */
  cellC: { type: Types.Int32, default: -1 },
  cellR: { type: Types.Int32, default: -1 },
});

/** A pokeable 3D button. */
export const DeskButton = createComponent('DeskButton', {
  action: { type: Types.String, default: '' },
});

/** Grab handle used to slide the whole board across the desk. */
export const BoardHandle = createComponent('BoardHandle', {});
