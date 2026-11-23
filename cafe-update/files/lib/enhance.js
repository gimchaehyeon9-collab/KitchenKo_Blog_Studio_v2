// 사진 자동 보정 (카페 공사전·중용) — 문제가 있는 사진만 밝기·대비·색 쏠림을 바로잡는다.
//
// 키친앤코 스튜디오의 [자동 보정]과 같은 기준으로 "문제가 있는 사진만" 고친다.
//   · 어두움      : 중간 밝기가 낮거나 어두운 곳이 너무 많음      → 밝게 (감마)
//   · 너무 밝음   : 중간 밝기가 높고 하얗게 날아간 곳이 많음      → 살짝 어둡게
//   · 밋밋함      : 밝은 곳과 어두운 곳의 차이가 아주 적음        → 대비를 펴 줌
//   · 색 쏠림     : 한쪽 색이 눈에 띄게 강함 (확실할 때만, 절반만 고침)
// 알맞은 사진(밝고 하얀 주방 포함)은 건드리지 않는다. 파일도 다시 저장하지 않는다.
//
// 🚨 원본은 지우지 않는다. 고친 사진만 같은 이름으로 바꿔 놓고, 고치기 전 파일은 <사진폴더>/_orig/ 에 남긴다.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const TH = { dark: 0.42, bright: 0.88, blown: 0.2, deadShadow: 0.45, flat: 0.38, cast: 0.15 };
const LABEL = { dark: '어두움', bright: '너무 밝음', flat: '밋밋함', cast: '색 쏠림' };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** raw RGB(3채널) 픽셀을 훑어 문제 종류와 보정값을 계산한다. 픽셀은 바꾸지 않는다. */
function look(data, w, h) {
  const hist = new Float64Array(256);
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 60000)));
  let cnt = 0, sr = 0, sg = 0, sb = 0, mc = 0;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const p = (y * w + x) * 3;
      const r = data[p], g = data[p + 1], b = data[p + 2];
      const l = Math.min(255, (0.299 * r + 0.587 * g + 0.114 * b) | 0);
      hist[l]++; cnt++;
      if (l >= 38 && l <= 217) { sr += r; sg += g; sb += b; mc++; }      // 중간 밝기 픽셀로 색 쏠림을 본다
    }
  }
  if (!cnt) return { kinds: [], params: {} };
  const pct = (q) => { let a = 0; const t = q * cnt; for (let i = 0; i < 256; i++) { a += hist[i]; if (a >= t) return i / 255; } return 1; };
  const p1 = pct(0.01), p50 = pct(0.5), p99 = pct(0.99);
  let low = 0; for (let i = 0; i < 51; i++) low += hist[i]; low /= cnt;
  let hi = 0; for (let i = 243; i < 256; i++) hi += hist[i]; hi /= cnt;

  const kinds = [];
  if (p50 < TH.dark || (low > TH.deadShadow && p50 < 0.5)) kinds.push('dark');
  else if (p50 > TH.bright && hi > TH.blown) kinds.push('bright');
  else if (p99 - p1 < TH.flat && p50 >= 0.3 && p50 <= 0.75) kinds.push('flat');   // 밝기가 한쪽으로 쏠린 사진(밝은 흰 주방 등)은 '밋밋함'으로 보지 않는다

  const params = { gamma: 1, bp: 0, wp: 1, gain: [1, 1, 1] };
  if (kinds.includes('dark')) params.gamma = clamp(Math.log(0.46) / Math.log(clamp(p50, 0.03, 0.95)), 0.62, 1);
  if (kinds.includes('bright')) params.gamma = clamp(Math.log(0.8) / Math.log(clamp(p50, 0.5, 0.99)), 1, 1.35);
  if (kinds.includes('flat')) { params.bp = clamp(p1 - 0.05, 0, 0.25); params.wp = clamp(p99 + 0.05, 0.75, 1); }

  if (mc > 200 && sg > 0) {
    const mr = sr / mc, mg = sg / mc, mb = sb / mc;
    const rr = mr / mg - 1, bb = mb / mg - 1;                              // 초록 대비 빨강·파랑이 얼마나 센가
    if (Math.max(Math.abs(rr), Math.abs(bb)) >= TH.cast) {
      kinds.push('cast');
      const half = (v) => clamp(1 - v * 0.5, 0.88, 1.12);                 // 쏠린 만큼의 절반만, 최대 ±12% 만 고친다
      params.gain = [half(rr), 1, half(bb)];
    }
  }
  return { kinds, params, stats: { p1, p50, p99, low, hi } };
}

/** 보정값으로 256칸 표 하나를 만든다 (감마 → 대비 펴기). */
function lutFor(p) {
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    let v = i / 255;
    if (p.gamma !== 1) v = Math.pow(v, p.gamma);
    if (p.bp > 0 || p.wp < 1) { const s = clamp((v - p.bp) / Math.max(0.05, p.wp - p.bp), 0, 1); v = v + 0.7 * (s - v); }   // 70% 만 반영
    lut[i] = Math.round(clamp(v, 0, 1) * 255);
  }
  return lut;
}

/** raw RGB 에 보정값을 적용한다 (제자리에서 바꾼다). */
function render(data, params) {
  const lut = lutFor(params), [gr, , gb] = params.gain;
  const useGain = gr !== 1 || gb !== 1;
  for (let p = 0; p < data.length; p += 3) {
    let r = data[p], b = data[p + 2];
    if (useGain) { r = Math.min(255, Math.round(r * gr)); b = Math.min(255, Math.round(b * gb)); }
    data[p] = lut[r]; data[p + 1] = lut[data[p + 1]]; data[p + 2] = lut[b];
  }
}

/** 사진 한 장을 살펴보고 문제가 있으면 고쳐서 같은 자리에 저장한다. 돌려주는 값: { changed, kinds } */
async function enhanceFile(file, origDir) {
  if (!/\.(jpe?g|png|webp)$/i.test(file)) return { changed: false, kinds: [] };   // 그 밖의 형식(gif 등)은 그대로 둔다
  const { data, info } = await sharp(file, { failOn: 'none' }).rotate().toColourspace('srgb').removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width < 64 || info.height < 64) return { changed: false, kinds: [] };
  const r = look(data, info.width, info.height);
  if (!r.kinds.length) return { changed: false, kinds: [] };
  render(data, r.params);
  const ext = path.extname(file).toLowerCase();
  let img = sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } });
  img = ext === '.png' ? img.png() : ext === '.webp' ? img.webp({ quality: 95 }) : img.jpeg({ quality: 95, chromaSubsampling: '4:4:4' });
  const tmp = file + '.enh.tmp';
  await img.toFile(tmp);
  fs.mkdirSync(origDir, { recursive: true });
  const keep = path.join(origDir, path.basename(file));
  if (!fs.existsSync(keep)) fs.copyFileSync(file, keep);                   // 처음 원본만 남긴다 (두 번 돌려도 원본이 덮이지 않게)
  fs.renameSync(tmp, file);
  return { changed: true, kinds: r.kinds, params: r.params };
}

/** photoDir 안의 names 를 차례로 살펴본다. 한 장이 실패해도 나머지는 계속한다. */
async function enhanceDir(photoDir, names, onLog = () => {}) {
  const origDir = path.join(photoDir, '_orig');
  const out = { fixed: 0, fine: 0, failed: 0, counts: { dark: 0, bright: 0, flat: 0, cast: 0 }, lines: [] };
  for (let i = 0; i < names.length; i++) {
    const name = names[i], file = path.join(photoDir, name);
    try {
      if (!fs.existsSync(file)) { out.failed++; continue; }
      const r = await enhanceFile(file, origDir);
      if (!r.changed) { out.fine++; continue; }
      out.fixed++;
      for (const k of r.kinds) out.counts[k]++;
      const line = `${i + 1}번 ${name} — ${r.kinds.map((k) => LABEL[k]).join('·')}`;
      out.lines.push(line); onLog(line);
    } catch (e) {
      out.failed++;
      onLog(`${i + 1}번 ${name} — 보정하지 못해 그대로 둡니다 (${String((e && e.message) || e).slice(0, 80)})`, 'warn');
    }
  }
  return out;
}

module.exports = { look, render, lutFor, enhanceFile, enhanceDir, LABEL, TH };
