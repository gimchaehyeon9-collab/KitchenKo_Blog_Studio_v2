/* 사진 기울기·원근 맞추기 — 기울기(돌리기) · 세로 원근 · 가로 원근을 따로 조절하고, 자동으로 찾고, 사진 위에 그은 선으로 계산해요.
   p.adj.rot = 도(시계 방향 +, ±15)  /  p.adj.vp = 세로 원근 -100~100 (+는 위쪽이 넓어져요: 올려다 찍어 위로 모여 보이는 세로선 펴기)
   p.adj.hp = 가로 원근 -100~100 (+는 오른쪽이 넓어져요: 옆에서 찍어 한쪽으로 모여 보이는 가로선 펴기)
   사진 크기·비율은 그대로이고, 휘어서 생긴 빈 모서리는 필요한 만큼만 키워서(확대) 채워요. */
(() => {
'use strict';
const KK = window.KK;
const KA = 0.3;                                   // 원근 ±100 일 때의 세기
KK.GEO_KEYS = ['rot', 'vp', 'hp'];
KK.GEO_RANGE = { rot: 15, vp: 100, hp: 100 };
KK.hasGeo = a => !!a && !!(a.rot || a.vp || a.hp);
KK.geoKey = a => ((a && a.rot) || 0) + ',' + ((a && a.vp) || 0) + ',' + ((a && a.hp) || 0);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

/* 보정 사진의 한 점(가운데 기준 픽셀 u,v) → 원본 사진의 점.  ① 줌 ② 돌리기 ③ 원근 */
function params(W, H, a) {
  const th = ((a && a.rot) || 0) * Math.PI / 180;
  return { W, H, hw: W / 2, hh: H / 2, c: Math.cos(th), s: Math.sin(th), a: -KA * ((a && a.vp) || 0) / 100, b: KA * ((a && a.hp) || 0) / 100, z: 1 };
}
function back(q, u, v) {
  const u0 = u / q.z, v0 = v / q.z, u1 = q.c * u0 + q.s * v0, v1 = -q.s * u0 + q.c * v0;
  const w = 1 + q.a * (v1 / q.hh) + q.b * (u1 / q.hw);
  return [u1 / w, v1 / w, w];
}
/* 빈 모서리가 안 생기는 가장 작은 확대 비율 */
function fitZoom(q) {
  const pts = []; for (const sx of [-1, -.5, 0, .5, 1]) for (const sy of [-1, -.5, 0, .5, 1]) if (Math.abs(sx) === 1 || Math.abs(sy) === 1) pts.push([sx * q.hw, sy * q.hh]);
  const inside = z => { q.z = z; for (const [u, v] of pts) { const r = back(q, u, v); if (!(r[2] > 0.2) || Math.abs(r[0]) > q.hw + 1e-6 || Math.abs(r[1]) > q.hh + 1e-6) return false; } return true; };
  if (inside(1)) { q.z = 1; return q; }
  let lo = 1, hi = 4; if (!inside(hi)) { q.z = hi; return q; }
  for (let i = 0; i < 28; i++) { const m = (lo + hi) / 2; if (inside(m)) hi = m; else lo = m; }
  q.z = hi; return q;
}
KK.geoZoom = (W, H, a) => fitZoom(params(W, H, a)).z;

/* RGBA 사진(src, W×H) → 보정된 새 RGBA */
KK.geoWarp = (src, W, H, a) => {
  const q = fitZoom(params(W, H, a)), out = new Uint8ClampedArray(W * H * 4), hw = q.hw, hh = q.hh, iz = 1 / q.z, c = q.c, s = q.s, qa = q.a / hh, qb = q.b / hw;
  const W1 = W - 1, H1 = H - 1;
  for (let y = 0, o = 0; y < H; y++) {
    const v0 = (y + 0.5 - hh) * iz;
    for (let x = 0; x < W; x++, o += 4) {
      const u0 = (x + 0.5 - hw) * iz, u1 = c * u0 + s * v0, v1 = -s * u0 + c * v0, iw = 1 / (1 + qa * v1 + qb * u1);
      let sx = u1 * iw + hw - 0.5, sy = v1 * iw + hh - 0.5;
      if (sx < 0) sx = 0; else if (sx > W1) sx = W1; if (sy < 0) sy = 0; else if (sy > H1) sy = H1;
      const x0 = sx | 0, y0 = sy | 0, x1 = x0 < W1 ? x0 + 1 : x0, y1 = y0 < H1 ? y0 + 1 : y0, fx = sx - x0, fy = sy - y0;
      const i00 = (y0 * W + x0) * 4, i10 = (y0 * W + x1) * 4, i01 = (y1 * W + x0) * 4, i11 = (y1 * W + x1) * 4;
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
      out[o] = src[i00] * w00 + src[i10] * w10 + src[i01] * w01 + src[i11] * w11;
      out[o + 1] = src[i00 + 1] * w00 + src[i10 + 1] * w10 + src[i01 + 1] * w01 + src[i11 + 1] * w11;
      out[o + 2] = src[i00 + 2] * w00 + src[i10 + 2] * w10 + src[i01 + 2] * w01 + src[i11 + 2] * w11;
      out[o + 3] = 255;
    }
  }
  return out;
};
/* 흑백(1채널) 버전 — 자동 찾기에서 후보 값마다 가볍게 보정해 보기 위해 */
function warpGray(g, W, H, a, noZoom) {
  const q = params(W, H, a); if (!noZoom) fitZoom(q);
  const out = new Float32Array(W * H), hw = q.hw, hh = q.hh, iz = 1 / q.z, c = q.c, s = q.s, qa = q.a / hh, qb = q.b / hw, W1 = W - 1, H1 = H - 1;
  for (let y = 0, o = 0; y < H; y++) {
    const v0 = (y + 0.5 - hh) * iz;
    for (let x = 0; x < W; x++, o++) {
      const u0 = (x + 0.5 - hw) * iz, u1 = c * u0 + s * v0, v1 = -s * u0 + c * v0, iw = 1 / (1 + qa * v1 + qb * u1);
      let sx = u1 * iw + hw - 0.5, sy = v1 * iw + hh - 0.5;
      if (sx < 0) sx = 0; else if (sx > W1) sx = W1; if (sy < 0) sy = 0; else if (sy > H1) sy = H1;
      const x0 = sx | 0, y0 = sy | 0, x1 = x0 < W1 ? x0 + 1 : x0, y1 = y0 < H1 ? y0 + 1 : y0, fx = sx - x0, fy = sy - y0;
      out[o] = g[y0 * W + x0] * (1 - fx) * (1 - fy) + g[y0 * W + x1] * fx * (1 - fy) + g[y1 * W + x0] * (1 - fx) * fy + g[y1 * W + x1] * fx * fy;
    }
  }
  return out;
}

/* ───── 자동: 세로·가로 원근 ─────
   세로 원근(vp)을 바꿔 가며 사진을 보정해 보고, "세로 경계선이 같은 열에 모이는 정도"가 가장 높은 값을 찾아요 (가로 원근은 가로 경계선이 같은 행에 모이는 정도).
   뚜렷한 가로·세로 직선이 적으면 ok=false (건드리지 않아요) */
function concentration(img, w, h, vertical) {
  const line = new Float32Array(vertical ? w : h); let tot = 0;
  for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
    const i = y * w + x, d = vertical ? img[i + 1] - img[i - 1] : img[i + w] - img[i - w], m = d < 0 ? -d : d;
    if (m > 22) { line[vertical ? x : y] += m; tot += m; }
  }
  if (tot < 1500) return -1;                                                     // 경계선이 거의 없음
  let sq = 0; for (let i = 0; i < line.length; i++) sq += line[i] * line[i];
  return sq / (tot * tot);                                                       // 한 줄에 몰릴수록 큼 (0~1)
}
function searchAxis(g, w, h, base, key) {
  const vertical = key === 'vp', at = v => concentration(warpGray(g, w, h, { ...base, [key]: v }), w, h, vertical);
  const coarse = []; for (let v = -100; v <= 100; v += 4) coarse.push([v, at(v)]);
  if (coarse.some(c => c[1] < 0)) return { v: 0, ok: false, gain: 0 };
  let bi = 0; for (let i = 1; i < coarse.length; i++) if (coarse[i][1] > coarse[bi][1]) bi = i;
  let best = coarse[bi][0], bs = coarse[bi][1];
  for (let v = best - 4; v <= best + 4 + 1e-9; v += 0.5) { if (v < -100 || v > 100) continue; const s = at(v); if (s > bs) { bs = s; best = v; } }
  const zero = at(0), others = coarse.filter(c => Math.abs(c[0] - best) >= 16).map(c => c[1]), mean = others.reduce((a, b) => a + b, 0) / (others.length || 1);
  const peak = bs / (mean || 1), gain = bs / (zero || 1);
  return { v: best, ok: peak >= 1.3 && gain >= 1.12, gain: Math.round(gain * 100) / 100, peak: Math.round(peak * 100) / 100, zero: Math.abs(best) < 3 };
}
/* g: 흑백(0~255) w×h (긴 변 300~400px 권장), rot: 이미 정한 기울기(도). 돌려주는 값 { vp, hp, okV, okH } */
KK.detectPersp = (g, w, h, rot) => {
  const base = { rot: rot || 0, vp: 0, hp: 0 };
  const v = searchAxis(g, w, h, base, 'vp'), hv = v.ok && !v.zero ? v.v : 0;
  const hz = searchAxis(g, w, h, { ...base, vp: hv }, 'hp');
  return { vp: v.ok ? v.v : 0, hp: hz.ok ? hz.v : 0, okV: v.ok, okH: hz.ok, zeroV: !!v.zero, zeroH: !!hz.zero, info: { v, h: hz } };
};

/* ───── 사진 위에 그은 선으로 계산 (도우미) ─────
   mode: 'h' 수평이어야 할 선 1개 / 'v' 수직이어야 할 선 1개 / 'pv' 서로 평행한 수직선 2개(세로 원근) / 'ph' 서로 평행한 수평선 2개(가로 원근)
   lines: [[[x1,y1],[x2,y2]], …]  원본 사진의 픽셀 좌표 (왼쪽 위가 0,0)   cur: 지금 값 {rot,vp,hp}
   돌려주는 값: { rot, vp, hp, residual(도, 남은 오차), clamped } */
KK.geoFromLines = (mode, lines, W, H, cur) => {
  const hw = W / 2, hh = H / 2, cu = cur || {};
  const L = lines.map(l => l.map(p => [p[0] - hw, p[1] - hh]));
  const fwd = (pt, a, b) => { const d = 1 - a * (pt[1] / hh) - b * (pt[0] / hw); return [pt[0] / d, pt[1] / d]; };
  const ang = (l, a, b) => { const p = fwd(l[0], a, b), q = fwd(l[1], a, b); return Math.atan2(q[1] - p[1], q[0] - p[0]) * 180 / Math.PI; };
  const n90 = d => { while (d > 90) d -= 180; while (d <= -90) d += 180; return d; };
  const devV = d => { const t = n90(d); return t > 0 ? t - 90 : t + 90; };           // 수직에서 얼마나 벗어났나 (-90,90]
  const a0 = -KA * (cu.vp || 0) / 100, b0 = KA * (cu.hp || 0) / 100;
  let rot = cu.rot || 0, vp = cu.vp || 0, hp = cu.hp || 0, residual = 0;
  const need = mode === 'pv' || mode === 'ph' ? 2 : 1;
  if (L.length < need) throw Error('선이 부족해요.');
  if (mode === 'h') { const d = n90(ang(L[0], a0, b0)); rot = -d; }
  else if (mode === 'v') { const d = devV(ang(L[0], a0, b0)); rot = -d; }
  else {
    const vert = mode === 'pv'; let best = null;
    for (let t = -KA; t <= KA + 1e-9; t += 0.0005) {
      const A = vert ? t : a0, B = vert ? b0 : t;
      const f = vert ? devV : n90, d1 = f(ang(L[0], A, B)), d2 = f(ang(L[1], A, B)), sp = Math.abs(n90(d1 - d2));
      if (!best || sp < best.sp - 1e-9) best = { t, sp, d1, d2 };
    }
    rot = -(best.d1 + best.d2) / 2; residual = best.sp;
    if (vert) vp = -best.t / KA * 100; else hp = best.t / KA * 100;
  }
  const clamped = Math.abs(rot) > KK.GEO_RANGE.rot || Math.abs(vp) > 100 || Math.abs(hp) > 100;
  return { rot: Math.round(clamp(rot, -KK.GEO_RANGE.rot, KK.GEO_RANGE.rot) * 10) / 10, vp: Math.round(clamp(vp, -100, 100) * 2) / 2, hp: Math.round(clamp(hp, -100, 100) * 2) / 2, residual: Math.round(residual * 100) / 100, clamped };
};
/* 도우미: 선을 여러 개 한꺼번에 — g = { h:[선…], v:[선…], pv:[선…(2개)], ph:[선…(2개)] } (원본 사진 픽셀 좌표)
   수평선 h·수직선 v 는 기울기만, 세로 평행선 pv 는 세로 원근(+기울기), 가로 평행선 ph 는 가로 원근(+기울기)을 정해요.
   쓰지 않은 항목은 undefined 로 돌려줘서 지금 값을 그대로 둬요.  기울기는 쓴 선들이 말하는 값의 평균 */
KK.geoFromGuides = (g, W, H, cur) => {
  const c = cur || {}, has = (k, n) => g[k] && g[k].length >= n;
  let vp = c.vp || 0, hp = c.hp || 0; const usePv = has('pv', 2), usePh = has('ph', 2);
  const last2 = k => g[k].slice(-2);
  for (let it = 0; it < 3 && (usePv || usePh); it++) {
    if (usePv) vp = KK.geoFromLines('pv', last2('pv'), W, H, { vp, hp }).vp;
    if (usePh) hp = KK.geoFromLines('ph', last2('ph'), W, H, { vp, hp }).hp;
  }
  const at = { vp, hp }, rots = [], res = {};
  if (has('h', 1)) rots.push(KK.geoFromLines('h', [g.h[g.h.length - 1]], W, H, at).rot);
  if (has('v', 1)) rots.push(KK.geoFromLines('v', [g.v[g.v.length - 1]], W, H, at).rot);
  if (usePv) { const r = KK.geoFromLines('pv', last2('pv'), W, H, at); rots.push(r.rot); res.residualV = r.residual; }
  if (usePh) { const r = KK.geoFromLines('ph', last2('ph'), W, H, at); rots.push(r.rot); res.residualH = r.residual; }
  if (rots.length) res.rot = Math.round(clamp(rots.reduce((a, b) => a + b, 0) / rots.length, -KK.GEO_RANGE.rot, KK.GEO_RANGE.rot) * 10) / 10;
  if (usePv) res.vp = vp; if (usePh) res.hp = hp;
  return res;
};
/* 테스트·미리보기용: 보정 값으로 원본의 한 점이 보정 사진 어디로 가는지 (가운데 기준 픽셀) */
KK.geoForward = (pt, W, H, a) => {
  const q = fitZoom(params(W, H, a)), d = 1 - q.a * (pt[1] / q.hh) - q.b * (pt[0] / q.hw), u1 = pt[0] / d, v1 = pt[1] / d;
  return [(q.c * u1 - q.s * v1) * q.z, (q.s * u1 + q.c * v1) * q.z];
};

const loadImg = src => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(Error('이미지를 읽지 못했어요.')); im.src = src; });
const grayOf = async (p, maxSide) => {
  const im = await loadImg(p.data), sc = Math.min(1, maxSide / Math.max(im.naturalWidth, im.naturalHeight));
  const w = Math.max(8, Math.round(im.naturalWidth * sc)), h = Math.max(8, Math.round(im.naturalHeight * sc));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(im, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data, g = new Uint8Array(w * h);
  for (let i = 0; i < g.length; i++) g[i] = (d[i * 4] * 299 + d[i * 4 + 1] * 587 + d[i * 4 + 2] * 114) / 1000;
  return { g, w, h };
};
/* 기울기 후보(0°와 직선 방향에서 찾은 값)마다 원근을 찾아 보고, 보정한 모습에서 가로·세로 선이 가장 가지런한 쪽을 골라요
   — 원근만 있는 사진을 기울기로 잘못 읽는 일을 줄여요. 후보가 하나뿐이면 그냥 그 값으로 찾아요 */
const evenness = (g, w, h, a) => {
  const im = warpGray(g, w, h, a), cv = concentration(im, w, h, true), ch = concentration(im, w, h, false);
  return Math.max(cv, 0.02) * Math.max(ch, 0.02);
};
KK.detectGeo = (g, w, h, cands) => {
  let best = null;
  for (const rot of cands) {
    const pe = KK.detectPersp(g, w, h, rot);
    const a = { rot, vp: pe.okV && !pe.zeroV ? pe.vp : 0, hp: pe.okH && !pe.zeroH ? pe.hp : 0 };
    const sc = cands.length > 1 ? evenness(g, w, h, a) : 0;
    if (!best || sc > best.sc) best = { rot, pe, sc };
  }
  return best;
};
/* 사진 한 장의 기울기 + 세로·가로 원근을 자동으로 — 원본 사진으로 재므로 몇 번을 눌러도 같은 값
   rotOverride 가 있으면 기울기는 그 값으로 고정하고 원근만 찾아요 */
KK.photoGeo = async (p, rotOverride) => {
  const big = await grayOf(p, 800), t = KK.detectTilt(big.g, big.w, big.h), sm = await grayOf(p, 300);
  const cands = rotOverride != null ? [rotOverride] : (t.ok && Math.abs(t.rot) >= 0.3 ? [0, t.rot] : [0]);
  const best = KK.detectGeo(sm.g, sm.w, sm.h, cands), pe = best.pe;
  return { rot: best.rot, okRot: t.ok, vp: pe.vp, hp: pe.hp, okV: pe.okV, okH: pe.okH, zeroV: pe.zeroV, zeroH: pe.zeroH };
};
})();
