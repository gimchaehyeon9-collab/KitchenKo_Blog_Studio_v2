// 사진들을 이어 붙인 간단한 영상(슬라이드쇼) 만들기 — 카페 글에 자동으로 올릴 영상.
//
// 사진 한 장당 약 2초, 사진 사이는 부드럽게 겹치며 넘어간다. 설치할 것이 없다:
// 사진은 sharp 로 1280×720 장면으로 만들고, 크롬(보이지 않게)에서 한 장씩 보여 주며 녹화한다.
// 영상 형식은 크롬이 만들 수 있는 것을 쓴다 (mp4 가능하면 mp4, 아니면 webm).
// 각인(로고)이 켜져 있으면 각인이 들어간 사진으로 만든다. 원본은 건드리지 않는다.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { chromium } = require('playwright');
const stamp = require('./stamp');

const W = 1280;
const H = 720;
const SEC = 2.0; // 사진 한 장을 보여 주는 시간(초)
const MAX_SLIDES = 40; // 사진이 아주 많으면 고르게 골라 쓴다

/** 한 장을 영상 장면(1280×720)으로: 같은 사진을 흐리게 깔고, 가운데에 사진 전체가 보이게. */
async function slide(file) {
  const base = sharp(file, { failOn: 'none' }).rotate();
  const bg = await base.clone().resize(W, H, { fit: 'cover' }).blur(24).modulate({ brightness: 0.75 }).toBuffer();
  const fg = await base.clone().resize(W, H, { fit: 'inside', withoutEnlargement: false }).toBuffer();
  const buf = await sharp(bg).composite([{ input: fg, gravity: 'centre' }]).jpeg({ quality: 88 }).toBuffer();
  return 'data:image/jpeg;base64,' + buf.toString('base64');
}

async function launchChrome() {
  try {
    return await chromium.launch({ channel: 'chrome', headless: true });
  } catch (e) {
    // 설치된 크롬을 못 쓰면 playwright 가 가진 크롬으로 한 번 더 (이 경우 영상은 webm 이 될 수 있다)
    return chromium.launch({ headless: true });
  }
}

/**
 * photoDir 의 사진들(names, 보여 줄 순서)로 영상을 만들어 outDir 에 video.mp4(또는 .webm)로 저장한다.
 * 돌려주는 값: 파일 이름 (예: 'video.mp4')
 */
async function make({ photoDir, names, outDir, stampOn = true, onLog = () => {}, fileOf = null }) {
  const srcOf = (n) => (fileOf ? fileOf(n) : path.join(photoDir, n));
  let list = names.filter((n) => fs.existsSync(srcOf(n)));
  if (!list.length) throw new Error('영상으로 만들 사진이 없습니다.');
  if (list.length > MAX_SLIDES) {
    const step = list.length / MAX_SLIDES;
    list = Array.from({ length: MAX_SLIDES }, (_, i) => list[Math.floor(i * step)]);
  }
  onLog(`영상 장면 ${list.length}장 준비 중…${stampOn ? ' (레몬하우스 각인 포함)' : ''}`);
  const slides = [];
  for (const name of list) {
    const file = stampOn ? await stamp.ensure(photoDir, name, srcOf(name)) : srcOf(name);
    slides.push(await slide(file));
  }
  fs.mkdirSync(outDir, { recursive: true });
  const tmp = path.join(outDir, 'video.part');
  fs.rmSync(tmp, { force: true });
  const browser = await launchChrome();
  let ext = 'webm';
  try {
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    await page.exposeFunction('__chunk', (b64) => fs.appendFileSync(tmp, Buffer.from(b64, 'base64')));
    onLog(`영상을 만드는 중입니다 (약 ${Math.ceil(list.length * SEC)}초)…`);
    const mime = await page.evaluate(
      async ({ slides, W, H, SEC }) => {
        const load = (src) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('장면 그림을 열지 못했습니다.')); im.src = src; });
        const imgs = [];
        for (const s of slides) imgs.push(await load(s));
        const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
        const ctx = cv.getContext('2d');
        const types = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
        const type = types.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
        if (!window.MediaRecorder) throw new Error('이 크롬에서는 영상을 만들 수 없습니다.');
        const rec = new MediaRecorder(cv.captureStream(30), type ? { mimeType: type, videoBitsPerSecond: 4e6 } : undefined);
        const pending = [];
        rec.ondataavailable = (e) => {
          if (!e.data || !e.data.size) return;
          pending.push(e.data.arrayBuffer().then((buf) => {
            let bin = ''; const u8 = new Uint8Array(buf);
            for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
            return window.__chunk(btoa(bin));
          }));
        };
        const stopped = new Promise((res) => { rec.onstop = res; });
        const FADE = Math.min(0.5, SEC / 3), total = imgs.length * SEC;
        ctx.drawImage(imgs[0], 0, 0); rec.start(500);
        const t0 = performance.now();
        await new Promise((resolve) => {
          const tick = () => {
            const t = (performance.now() - t0) / 1000;
            if (t >= total) return resolve();
            const i = Math.min(imgs.length - 1, Math.floor(t / SEC)), fr = t - i * SEC;
            ctx.globalAlpha = 1; ctx.drawImage(imgs[i], 0, 0);
            if (fr > SEC - FADE && i + 1 < imgs.length) { ctx.globalAlpha = (fr - (SEC - FADE)) / FADE; ctx.drawImage(imgs[i + 1], 0, 0); ctx.globalAlpha = 1; }
            setTimeout(tick, 33);
          };
          tick();
        });
        ctx.globalAlpha = 1; ctx.drawImage(imgs[imgs.length - 1], 0, 0);
        await new Promise((r) => setTimeout(r, 300));
        rec.stop(); await stopped; await Promise.all(pending);
        return rec.mimeType || type || 'video/webm';
      },
      { slides, W, H, SEC }
    );
    ext = /mp4/.test(mime) ? 'mp4' : 'webm';
  } finally {
    await browser.close().catch(() => {});
  }
  const size = fs.existsSync(tmp) ? fs.statSync(tmp).size : 0;
  if (size < 2000) {
    fs.rmSync(tmp, { force: true });
    throw new Error('영상이 만들어지지 않았습니다.');
  }
  const name = 'video.' + ext;
  for (const e of ['mp4', 'webm']) fs.rmSync(path.join(outDir, 'video.' + e), { force: true });
  fs.renameSync(tmp, path.join(outDir, name));
  onLog(`영상을 만들었습니다 — ${name} (${(size / 1048576).toFixed(1)}MB)`, 'success');
  return name;
}

module.exports = { make, SEC };
