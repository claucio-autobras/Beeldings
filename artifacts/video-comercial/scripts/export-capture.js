const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');

const DISPLAY = process.env.DISPLAY;
const URL = 'http://localhost:4173/';
const RAW = '/tmp/vidcap/raw.mkv';
const TOTAL_MS = 113500;

(async () => {
  const ctx = await chromium.launchPersistentContext('/tmp/vidcap/profile', {
    executablePath: process.env.CHROMIUM_BIN,
    headless: false,
    viewport: null,
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      '--no-sandbox',
      '--disable-gpu-vsync',
      '--autoplay-policy=no-user-gesture-required',
      '--window-position=0,0',
      '--window-size=1920,1080',
      '--kiosk',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--disable-infobars',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=Translate,TranslateUI,TranslateSubFrames',
      '--lang=pt-BR',
      '--accept-lang=pt-BR,pt,en',
      '--disable-session-crashed-bubble',
      '--noerrdialogs',
    ],
    env: { ...process.env, DISPLAY },
  });
  const browser = ctx;
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.addStyleTag !== undefined; // no-op
  await page.addInitScript(() => {
    window.__vidStart = 0;
    try {
      document.addEventListener('DOMContentLoaded', () => {
        document.documentElement.style.background = '#020617';
        document.body.style.background = '#020617';
      });
    } catch (e) {}
    window.__vidStop = 0;
    window.startRecording = () => { window.__vidStart = Date.now(); return Promise.resolve(); };
    window.stopRecording = () => { window.__vidStop = Date.now(); };
  });

  // start ffmpeg capture before navigation
  const ff = spawn('/nix/store/pkv32kjpg9pzfgqkqvsdn1nmln05fyjp-replit-runtime-path/bin/ffmpeg', [
    '-y',
    '-f', 'x11grab',
    '-framerate', '30',
    '-video_size', '1920x1080',
    '-use_wallclock_as_timestamps', '1',
    '-i', DISPLAY,
    '-copyts',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '16',
    '-pix_fmt', 'yuv420p',
    RAW,
  ], { stdio: ['pipe', 'inherit', 'pipe'] });
  let fferr = '';
  ff.stderr.on('data', d => { fferr += d.toString(); if (fferr.length > 20000) fferr = fferr.slice(-10000); });

  try { require('child_process').execSync(`${process.env.XDOTOOL} mousemove 1919 1079`, { env: process.env }); } catch (e) { console.log('xdotool failed', e.message); }
  await new Promise(r => setTimeout(r, 2000));
  await page.goto(URL, { waitUntil: 'load' });
  const dims = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  console.log('VIEWPORT=' + JSON.stringify(dims));

  // wait for recording start signal
  await page.waitForFunction(() => window.__vidStart > 0, null, { timeout: 30000 });
  const startMs = await page.evaluate(() => window.__vidStart);
  console.log('START_EPOCH_MS=' + startMs);

  // wait for full pass + margin
  await page.waitForFunction(() => window.__vidStop > 0, null, { timeout: TOTAL_MS + 60000 });
  const stopMs = await page.evaluate(() => window.__vidStop);
  console.log('STOP_EPOCH_MS=' + stopMs);
  await new Promise(r => setTimeout(r, 1500));

  ff.stdin.write('q');
  await new Promise(r => ff.on('close', r));
  await browser.close();
  fs.writeFileSync('/tmp/vidcap/timing.json', JSON.stringify({ startMs, stopMs }));
  console.log('DONE');
})().catch(e => { console.error(e); process.exit(1); });
