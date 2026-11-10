/** Set saved progress (video/rec.json "level", 0-based) and reload the page. */
import fs from 'node:fs';
import path from 'node:path';

export default async function run({ page, workspaceRoot }) {
  const cfg = JSON.parse(fs.readFileSync(path.join(workspaceRoot, 'video/rec.json'), 'utf8'));
  await page.evaluate((lvl) => localStorage.setItem('prism-desk-level', String(lvl)), cfg.level ?? 0);
  return { level: cfg.level ?? 0 };
}
