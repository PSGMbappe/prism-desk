/**
 * Records the managed emulator page as JPEG frames using Chrome's screencast.
 * Reads video/rec.json: { "scene": "s01", "seconds": 120 } (seconds = safety limit).
 * Writes video/frames/<scene>/f00000.jpg ... and timestamps.json.
 * Run: npx iwsdk browser run video/record.mjs --timeout <ms>
 */
import fs from 'node:fs';
import path from 'node:path';

export default async function run({ page, cdp, workspaceRoot }) {
  const cfg = JSON.parse(fs.readFileSync(path.join(workspaceRoot, 'video/rec.json'), 'utf8'));
  const dir = path.join(workspaceRoot, 'video/frames', cfg.scene);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const session = cdp ?? (await page.context().newCDPSession(page));
  const stamps = [];
  let n = 0;
  const onFrame = async (frame) => {
    const name = `f${String(n++).padStart(5, '0')}.jpg`;
    fs.writeFileSync(path.join(dir, name), Buffer.from(frame.data, 'base64'));
    stamps.push({ name, t: frame.metadata.timestamp });
    try {
      await session.send('Page.screencastFrameAck', { sessionId: frame.sessionId });
    } catch {
      /* session closing */
    }
  };
  session.on('Page.screencastFrame', onFrame);
  await session.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 92,
    maxWidth: 1920,
    maxHeight: 1080,
    everyNthFrame: 1,
  });
  fs.writeFileSync(path.join(dir, 'started'), String(Date.now()));
  // Stop when the director drops a "stop" file, or after the safety limit.
  const stopFile = path.join(dir, 'stop');
  const limit = Date.now() + cfg.seconds * 1000;
  while (!fs.existsSync(stopFile) && Date.now() < limit) {
    await new Promise((r) => setTimeout(r, 50));
  }
  await session.send('Page.stopScreencast');
  session.off?.('Page.screencastFrame', onFrame);
  fs.writeFileSync(path.join(dir, 'timestamps.json'), JSON.stringify(stamps));
  return { scene: cfg.scene, frames: n };
}
