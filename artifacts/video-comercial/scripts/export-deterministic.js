const { chromium } = require('playwright-core');
const { spawn } = require('child_process');

const URL = process.env.URL || 'http://localhost:4173/';
const FPS = +(process.env.FPS || 24);
const TOTAL_MS = +(process.env.TOTAL_MS || 113500);
const FRAMES = Math.round((TOTAL_MS / 1000) * FPS);
const OUT = process.env.OUT || '/tmp/vidcap/det.mp4';
const FFMPEG = process.env.FFMPEG || 'ffmpeg';

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_BIN,
    headless: true,
    args: ['--no-sandbox', '--force-device-scale-factor=1', '--mute-audio', '--lang=pt-BR'],
  });
  const page = await browser.newPage({
    viewport: { width: +(process.env.W || 1920), height: +(process.env.H || 1080) },
  });

  await page.addInitScript(() => {
    const t0 = Date.now();
    let vt = 0;
    let rafQ = [];
    let timers = [];
    let nextId = 1;

    const realSetTimeout = window.setTimeout.bind(window);

    Date.now = () => t0 + vt;
    performance.now = () => vt;

    window.requestAnimationFrame = (cb) => {
      const id = nextId++;
      rafQ.push({ id, cb });
      return id;
    };
    window.cancelAnimationFrame = (id) => { rafQ = rafQ.filter(x => x.id !== id); };

    window.setTimeout = (cb, delay = 0, ...args) => {
      if (typeof cb !== 'function') return 0;
      const id = nextId++;
      timers.push({ id, cb, due: vt + Math.max(0, +delay || 0), args, interval: 0 });
      return id;
    };
    window.clearTimeout = (id) => { timers = timers.filter(x => x.id !== id); };
    window.setInterval = (cb, delay = 100, ...args) => {
      if (typeof cb !== 'function') return 0;
      const id = nextId++;
      timers.push({ id, cb, due: vt + Math.max(1, +delay || 1), args, interval: Math.max(1, +delay || 1) });
      return id;
    };
    window.clearInterval = window.clearTimeout;

    window.startRecording = () => Promise.resolve();
    window.stopRecording = () => {};

    window.__vtStep = (ms) => {
      vt += ms;
      for (let guard = 0; guard < 1000; guard++) {
        const due = timers.filter(x => x.due <= vt).sort((a, b) => a.due - b.due);
        if (!due.length) break;
        for (const tm of due) {
          if (tm.interval) {
            tm.due += tm.interval;
          } else {
            timers = timers.filter(x => x.id !== tm.id);
          }
          try { tm.cb(...tm.args); } catch (e) {}
        }
      }
      const q = rafQ; rafQ = [];
      for (const { cb } of q) { try { cb(vt); } catch (e) {} }
      return new Promise(r => realSetTimeout(r, 0));
    };
    window.__vtNow = () => vt;

    document.addEventListener('DOMContentLoaded', () => {
      document.documentElement.style.background = '#020617';
      document.body.style.background = '#020617';
      const st = document.createElement('style');
      st.textContent = '[class*="blur-[1"]{filter:none!important;-webkit-mask-image:radial-gradient(closest-side, black 35%, transparent 100%)!important;mask-image:radial-gradient(closest-side, black 35%, transparent 100%)!important;}';
      document.head.appendChild(st);
    });
  });

  const ff = spawn('nice', ['-n', '10', FFMPEG,
    '-y',
    '-f', 'image2pipe',
    '-framerate', String(FPS),
    '-i', '-',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
    '-pix_fmt', 'yuv420p',
    OUT,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  ff.on('error', (e) => { console.error('ffmpeg error:', e); process.exit(1); });

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => (document.fonts ? document.fonts.ready : null));
  await new Promise(r => setTimeout(r, 3000));

  const stepMs = 1000 / FPS;
  for (let i = 0; i < FRAMES; i++) {
    await page.evaluate((ms) => window.__vtStep(ms), stepMs);
    const buf = await page.screenshot({ type: 'jpeg', quality: +(process.env.Q || 92) });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (i % 120 === 0) console.log(`frame ${i}/${FRAMES}`);
  }
  ff.stdin.end();
  const code = await new Promise(r => ff.on('close', r));
  await browser.close();
  if (code !== 0) {
    console.error(`ffmpeg saiu com código ${code}`);
    process.exit(1);
  }
  console.log('DONE');
})().catch(e => { console.error(e); process.exit(1); });
