/* 사진 내보내기 — 네이버로 보내거나 압축 파일로 저장할 사진을 "올린 원본 파일"에서 바로 만들어요.
   예전에는 원본 → 2000px 작은 사본 → 보정 → 로고 → 콜라주 …로 JPG를 여러 번 다시 저장해서 화질이 깨졌어요.
   지금은 화면에 보이는 작은 사본은 미리보기용으로만 쓰고, 내보낼 때는
     ① 손 안 댄 사진(보정·로고 없음, 방향 정상, sRGB)은 JPG 파일 그대로 — 위치정보(EXIF)만 빼고 픽셀은 한 점도 안 바꿔요
     ② 보정·로고·콜라주가 있으면 원본 크기(긴 변 4096px까지)에서 한 번에 그려 높은 화질(95)로 단 한 번만 저장해요
   네이버 사진 한 장 제한을 넘지 않도록 파일이 크면 화질을 조금씩만 낮춰요. */
(() => {
'use strict';
const KK = window.KK;
const MAX_SIDE = 4096, Q = .95, LIMIT = 9 * 1024 * 1024, COLLAGE_W = 3200, COLLAGE_MAX_H = 5600;

const loadImage = src => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(Error('사진을 열 수 없어요.')); im.src = src; });
const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
const toBlob = (c, q) => new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(Error('사진을 만들지 못했어요.')), 'image/jpeg', q));

/* ── JPG 파일 구조 읽기: 크기 · 방향(EXIF) · 색 프로필, 그리고 위치정보 등을 뺀 같은 사진 ── */
function exifOrient(u8, p, end) {            // p = 'Exif\0\0' 시작
  const b = p + 6; if (b + 8 > end) return 1;
  const le = u8[b] === 0x49, r16 = o => le ? (u8[o] | (u8[o + 1] << 8)) : ((u8[o] << 8) | u8[o + 1]);
  const r32 = o => le ? ((u8[o] | (u8[o + 1] << 8) | (u8[o + 2] << 16) | (u8[o + 3] << 24)) >>> 0) : (((u8[o] << 24) | (u8[o + 1] << 16) | (u8[o + 2] << 8) | u8[o + 3]) >>> 0);
  if (r16(b + 2) !== 42) return 1;
  const ifd = b + r32(b + 4); if (ifd + 2 > end) return 1;
  const n = r16(ifd);
  for (let i = 0; i < n; i++) { const e = ifd + 2 + i * 12; if (e + 12 > end) break; if (r16(e) === 0x0112) return r16(e + 8) || 1; }
  return 1;
}
const starts = (u8, p, str) => { for (let i = 0; i < str.length; i++) if (u8[p + i] !== str.charCodeAt(i)) return false; return true; };
function jpegScan(u8) {
  if (u8.length < 4 || u8[0] !== 0xFF || u8[1] !== 0xD8) return null;
  let pos = 2, w = 0, h = 0, orient = 1, icc = [], sof = false;
  const drop = [];                            // 빼 낼 구간 [시작, 끝)
  for (;;) {
    if (pos + 2 > u8.length) return null;
    if (u8[pos] !== 0xFF) return null;
    const m = u8[pos + 1];
    if (m === 0xFF) { pos++; continue; }
    if (m === 0xD9) { pos += 2; break; }
    if (m === 0x01 || (m >= 0xD0 && m <= 0xD8) || m === 0x00) return null;
    if (pos + 4 > u8.length) return null;
    const len = (u8[pos + 2] << 8) | u8[pos + 3]; if (len < 2 || pos + 2 + len > u8.length) return null;
    const end = pos + 2 + len;
    if (m === 0xE1) { if (starts(u8, pos + 4, 'Exif\0\0')) orient = exifOrient(u8, pos + 4, end); drop.push([pos, end]); }
    else if (m === 0xE2) { if (starts(u8, pos + 4, 'ICC_PROFILE\0')) icc.push(u8.subarray(pos + 18, end)); else drop.push([pos, end]); }   // 색 프로필은 두고, 다른 사진을 이어 붙이는 정보(MPF)는 뺌
    else if ((m >= 0xE3 && m <= 0xED) || m === 0xEF || m === 0xFE) drop.push([pos, end]);
    else if (m === 0xC0 || m === 0xC1 || m === 0xC2) { if (sof) return null; sof = true; h = (u8[pos + 5] << 8) | u8[pos + 6]; w = (u8[pos + 7] << 8) | u8[pos + 8]; }
    else if ((m >= 0xC3 && m <= 0xCF) && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return null;   // 산술 부호화 · 무손실 JPG 등은 건드리지 않음
    pos = end;
    if (m === 0xDA) {                         // 이미지 데이터 — 다음 표시(마커)가 나올 때까지 건너뜀
      for (;;) {
        const k = u8.indexOf(0xFF, pos); if (k < 0 || k + 1 >= u8.length) return null;
        const nb = u8[k + 1];
        if (nb === 0x00 || (nb >= 0xD0 && nb <= 0xD7) || nb === 0xFF) { pos = k + 1 + (nb === 0xFF ? 0 : 1); continue; }
        pos = k; break;
      }
    }
  }
  if (!sof || !w || !h) return null;
  // 색 프로필: 없거나 sRGB면 그대로 둬도 색이 같아요. 다른 프로필(Display P3 등)은 다시 그리면서 sRGB로 바꿔야 색이 안 변해요.
  let srgb = true;
  if (icc.length) { let s = ''; for (const c of icc) for (let i = 0; i < c.length; i++) s += String.fromCharCode(c[i]); srgb = /sRGB/.test(s.replace(/\0/g, '')); }   // v2 프로필은 글자가 그대로, v4 프로필은 글자 사이에 빈 바이트가 끼어 있어요
  return { w, h, orient, srgb, end: pos, drop };
}
function stripped(u8, info) {                 // 위치정보 등을 뺀 JPG 바이트 (남은 부분은 한 바이트도 안 바뀜)
  const parts = []; let a = 0;
  for (const [s, e] of info.drop) { if (s > a) parts.push(u8.subarray(a, s)); a = e; }
  parts.push(u8.subarray(a, info.end));
  return new Blob(parts, { type: 'image/jpeg' });
}
KK._jpeg = { jpegScan, stripped };

/* ── 원본 열기 · 작게 줄이기 · 보정 ── */
async function decode(p) {
  if (p.file) { try { const bmp = await createImageBitmap(p.file, { imageOrientation: 'from-image' }); return { img: bmp, w: bmp.width, h: bmp.height, close: () => { try { bmp.close(); } catch (_) {} } }; } catch (_) {} }
  const im = await loadImage(p.data); return { img: im, w: im.naturalWidth, h: im.naturalHeight, close() {} };   // 원본 파일이 없으면(옛 사진) 화면용 사본으로
}
/* 반씩 줄여 가며 목표 크기에 가깝게 — 한 번에 확 줄이는 것보다 훨씬 또렷해요 */
function drawFit(src, sw, sh, ctx, dx, dy, dw, dh) {
  let cur = src, cw = sw, ch = sh;
  while (cw / 2 >= dw && ch / 2 >= dh) {
    const nw = Math.max(1, Math.round(cw / 2)), nh = Math.max(1, Math.round(ch / 2)), c = canvas(nw, nh), g = c.getContext('2d');
    g.imageSmoothingQuality = 'high'; g.drawImage(cur, 0, 0, nw, nh); cur = c; cw = nw; ch = nh;
  }
  ctx.imageSmoothingQuality = 'high'; ctx.drawImage(cur, dx, dy, dw, dh);
}
const fitSize = (w, h, max) => { const k = Math.min(1, max / Math.max(w, h)); return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))]; };
/* 사진 한 장을 tw×th 로 그리고 색톤·기울기·원근 보정을 입힌 캔버스 */
async function photoCanvas(p, tw, th, max = MAX_SIDE) {
  const d = await decode(p);
  try {
    if (!tw) [tw, th] = fitSize(d.w, d.h, max);
    const c = canvas(tw, th), ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    drawFit(d.img, d.w, d.h, ctx, 0, 0, c.width, c.height);
    if (KK.hasAdj(p)) {
      const a = p.adj; let id = ctx.getImageData(0, 0, c.width, c.height);
      if (KK.hasTone(a)) KK.toneApply(id.data, c.width, c.height, a);
      if (KK.hasGeo(a)) id = new ImageData(KK.geoWarp(id.data, c.width, c.height, a), c.width, c.height);
      ctx.putImageData(id, 0, 0);
    }
    return c;
  } finally { d.close(); }
}
KK.photoCanvas = photoCanvas;

/* 저장 — 파일이 너무 크면 화질을 조금씩만 낮추고, 그래도 크면 크기를 줄여요 */
async function encode(c, q = Q) {
  let b = await toBlob(c, q);
  for (let k = 0; b.size > LIMIT && k < 6; k++) {
    if (q > .84) q -= .04; else { const n = canvas(c.width * .85, c.height * .85); n.getContext('2d').drawImage(c, 0, 0, n.width, n.height); c = n; }
    b = await toBlob(c, q);
  }
  return b;
}

/* ── 로고(키친앤코) / 각인(레몬하우스) — 글자 위에 얹어요 (사진 크기에 비례) ── */
let kkLogo = null;
KK.logoPainter = async () => {
  const cb = document.getElementById('optLogo'); if (cb && !cb.checked) return null;
  if (KK.brandKey === 'lemon' && KK._lemon && KK._lemon.drawLemon) return (ctx, W, H) => KK._lemon.drawLemon(ctx, W, H);
  if (!kkLogo) kkLogo = await loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(KK.LOGO_SVG));
  return (ctx, W, H) => {
    const lw = 0.34 * Math.min(W, H * 0.75), lh = lw * 145 / 509, mb = lw * 0.19;
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.28)'; ctx.shadowBlur = Math.max(4, lw * 0.015);
    ctx.drawImage(kkLogo, (W - lw) / 2, H - mb - lh, lw, lh); ctx.restore();
  };
};

/* ── 사진 한 장 → { blob, lossless } ── */
KK.exportPhoto = async (p, opt = {}) => {
  const paint = opt.logo === false ? null : await KK.logoPainter();
  if (!paint && !KK.hasAdj(p) && p.file && (p.file.type === 'image/jpeg' || /\.jpe?g$/i.test(p.file.name || ''))) {
    try {
      const u8 = new Uint8Array(await p.file.arrayBuffer()), info = jpegScan(u8);
      if (info && info.orient === 1 && info.srgb && Math.max(info.w, info.h) <= MAX_SIDE) {
        const blob = stripped(u8, info);
        if (blob.size <= LIMIT) return { blob, lossless: true };
      }
    } catch (_) {}
  }
  const c = await photoCanvas(p);
  if (paint) await paint(c.getContext('2d'), c.width, c.height);
  return { blob: await encode(c), lossless: false };
};

/* ── 카드(사진 1장 또는 콜라주) → { blob } ── */
KK.exportCard = async (card, opt = {}) => {
  const photos = card.photoIds.map(id => KK.photos.get(id)).filter(Boolean);
  if (!photos.length) return null;
  if (photos.length === 1) return KK.exportPhoto(photos[0], opt);
  const paint = opt.logo === false ? null : await KK.logoPainter();
  const rows = KK.layoutRows(card);
  const size = W => {
    const gap = Math.round(12 * W / 1600);
    const sized = rows.map(r => { const ps = r.map(id => KK.photos.get(id)); return { ps, h: (W - gap * (ps.length - 1)) / ps.reduce((s, p) => s + p.w / p.h, 0) }; });
    return { gap, sized, total: sized.reduce((s, r) => s + r.h, 0) + gap * (sized.length - 1) };
  };
  let W = COLLAGE_W, z = size(W);
  if (z.total > COLLAGE_MAX_H) { W = Math.max(1600, Math.round(W * COLLAGE_MAX_H / z.total)); z = size(W); }
  const c = canvas(W, z.total), ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  let y = 0;
  for (const r of z.sized) {
    let x = 0;
    for (const p of r.ps) {
      const w = r.h * p.w / p.h, tile = await photoCanvas(p, Math.round(w), Math.round(r.h));
      ctx.drawImage(tile, x, y, w, r.h); x += w + z.gap;
    }
    y += r.h + z.gap;
  }
  if (paint) await paint(ctx, c.width, c.height);
  return { blob: await encode(c), lossless: false };
};

/* ── 대표사진 1080×1080 (원본에서 한 번에) → Blob ── */
KK.exportCover = async () => {
  const s = KK.state, p = KK.photos.get(s.cover.photoId); if (!p) return null;
  const src = await photoCanvas(p, 0, 0, 3200);        // 1080 으로 줄이기 전 큰 그림 — 확대(줌)해도 또렷하게
  const out = canvas(1080, 1080), ctx = out.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1080, 1080);
  const r = KK.coverRect(s.cover, src.width, src.height);
  drawFit(src, src.width, src.height, ctx, r.x, r.y, r.w, r.h);
  return toBlob(out, Q);
};
})();
