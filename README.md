# Prism Desk

A hands-first mixed reality puzzle for Meta Quest. Your real desk becomes a
light lab: pinch mirror tiles, drop them on the grid, and bend a beam of
light through every gem and into the receiver.

Built with the [Immersive Web SDK](https://github.com/facebook/immersive-web-sdk)
(WebXR) for the Meta VR Start Developer Competition 2026: Gaming track,
New Experience division.

## How to play

1. Open the game in the Meta Quest browser and tap **Enter XR**.
2. Sit at a desk or table. The board lands on the nearest detected table
   (Quest room scan), or in front of you at desk height if none is found.
3. **Pinch** a mirror from the tray, carry it over the grid and let go. A ring
   previews the square it will snap to.
4. Steer the beam through every purple gem into the green receiver.
5. **Poke** Next to continue or Reset to start the level over. Pinch the bar
   behind the board to slide it somewhere else.

No controllers needed. Everything is within a two-foot reach, and each level
takes a minute or two. Progress is saved on the device.

## Design notes

- **Hands-first:** near-field pinch grab for tiles, finger poke for buttons.
- **Seated:** the whole game fits on a desk in front of you.
- **Passthrough with purpose:** the board snaps to your real table using
  plane detection, and sits in your room rather than in a virtual one.
- **Light on the GPU:** about 60 simple meshes, no shadows, no texture
  downloads, synthesized sound effects, no per-frame allocation.
- **Verified puzzles:** `npm run check:levels` brute-forces every level to
  prove it is solvable and report the minimum number of mirrors.

## Development

```bash
npm install
npm run dev            # IWSDK dev server with the Quest emulator (IWER)
npm run typecheck
npm run check:levels   # prove every level is solvable
npm run build          # static site in dist/
```

Puzzle logic lives in `src/puzzle.ts` (pure, testable); the ECS game system
is `src/game.ts`.
