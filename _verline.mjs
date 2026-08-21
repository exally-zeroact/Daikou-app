import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
const srv = spawn('npx', ['http-server', '-p', '8099', '-c-1', '-s', '.'], { shell: true, cwd: process.cwd() });
await new Promise((r) => setTimeout(r, 4000));
const b = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
const p = await b.newPage({ viewport: { width: 390, height: 850 } });
await p.goto('http://localhost:8099/index.html', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(4000);
const txt = await p.evaluate(() => {
  const el = document.getElementById('_st_appVersionLine');
  if (!el) return '(行が無い)';
  if (typeof window._loadAppVersion === 'function') window._loadAppVersion();
  return el.textContent;
});
await p.waitForTimeout(2500);
const txt2 = await p.evaluate(() => document.getElementById('_st_appVersionLine').textContent);
console.log('版の行（押す前）:', JSON.stringify(txt));
console.log('版の行（少し待って）:', JSON.stringify(txt2));
await b.close(); srv.kill();
