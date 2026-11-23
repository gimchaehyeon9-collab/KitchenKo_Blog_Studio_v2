/* 사진 기울기(수평·수직) 자동 찾기
   인테리어 사진은 가구 모서리·선반·상판·문틀처럼 가로·세로 직선이 많아요. 사진 속 뚜렷한 경계선 점들을 -10°~+10° 돌려 보면서
   "가로줄·세로줄 위에 가장 많이 겹쳐 모이는 각도"를 찾아요 (그 각도만큼 돌리면 직선들이 가로·세로로 반듯해져요).
   직선이 적거나 곡선·대각선 위주라서 뚜렷한 답이 없으면 ok=false 로 '모르겠음'을 돌려줘요.
   돌려주는 rot: 사진을 이만큼(도, 시계 방향이 +) 돌리면 반듯해진다는 값 */
(() => {
'use strict';
const KK = window.KK;
const RANGE = 10;

/* g: 흑백 픽셀(0~255) 배열, w×h.  돌려주는 값: { rot, ratio, share, ok } */
KK.detectTilt = (g, w, h) => {
  // ① 3×3 평균으로 잡음을 줄이고 소벨로 경계선 세기를 구합니다
  const s = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    s[i] = (g[i - w - 1] + g[i - w] + g[i - w + 1] + g[i - 1] + g[i] + g[i + 1] + g[i + w - 1] + g[i + w] + g[i + w + 1]) / 9;
  }
  const mag = new Float32Array(w * h); let maxM = 0;
  for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
    const i = y * w + x;
    const gx = (s[i - w + 1] + 2 * s[i + 1] + s[i + w + 1]) - (s[i - w - 1] + 2 * s[i - 1] + s[i + w - 1]);
    const gy = (s[i + w - 1] + 2 * s[i + w] + s[i + w + 1]) - (s[i - w - 1] + 2 * s[i - w] + s[i - w + 1]);
    const m = Math.hypot(gx, gy); mag[i] = m; if (m > maxM) maxM = m;
  }
  if (maxM < 40) return { rot: 0, ratio: 0, share: 0, ok: false };                 // 거의 밋밋한 사진
  // ② 강한 경계선 점만 (세기 상위 약 12%, 최대 6만 점)
  const hs = new Uint32Array(256); for (let i = 0; i < mag.length; i++) hs[Math.min(255, Math.floor(mag[i] / maxM * 255))]++;
  let acc = 0, cut = 255; const want = Math.min(mag.length * 0.12, 60000); for (let b = 255; b >= 0; b--) { acc += hs[b]; if (acc >= want) { cut = b; break; } }
  const thr = Math.max(cut / 255 * maxM, maxM * 0.06);
  const xs = [], ys = [], cx = w / 2, cy = h / 2;
  for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) if (mag[y * w + x] >= thr) { xs.push(x - cx); ys.push(y - cy); }
  const n = xs.length; if (n < 200) return { rot: 0, ratio: 0, share: 0, ok: false };
  // ③ 각도마다 점들을 돌린 뒤 가로줄(y')·세로줄(x')로 모이는 정도(제곱합)를 비교
  const half = Math.ceil(Math.hypot(w, h) / 2) + 2, size = half * 2 + 1, hr = new Uint32Array(size), hc = new Uint32Array(size);
  const score = deg => {
    const r = deg * Math.PI / 180, c = Math.cos(r), sn = Math.sin(r); hr.fill(0); hc.fill(0);
    for (let k = 0; k < n; k++) { const x = xs[k], y = ys[k]; hc[Math.round(x * c - y * sn) + half]++; hr[Math.round(x * sn + y * c) + half]++; }
    let t = 0; for (let i = 0; i < size; i++) t += hr[i] * hr[i] + hc[i] * hc[i];
    return t;
  };
  const coarse = [];
  for (let d = -RANGE; d <= RANGE + 1e-9; d += 0.5) coarse.push([d, score(d)]);
  let bi = 0; for (let i = 1; i < coarse.length; i++) if (coarse[i][1] > coarse[bi][1]) bi = i;
  let best = coarse[bi][0], bs = coarse[bi][1];
  for (let d = best - 0.6; d <= best + 0.6 + 1e-9; d += 0.05) { if (d < -RANGE || d > RANGE) continue; const v = score(d); if (v > bs) { bs = v; best = d; } }
  // ④ 믿을 만한지: 다른 각도(최고점에서 1.5° 이상 떨어진 곳)보다 얼마나 뚜렷하게 높은가
  const others = coarse.filter(([d]) => Math.abs(d - best) >= 1.5).map(c => c[1]), mean = others.reduce((a, b) => a + b, 0) / (others.length || 1);
  const ratio = bs / (mean || 1), zero = score(0);
  const share = Math.max(0, (bs - mean) / (bs || 1));
  const ok = ratio >= 1.25 && bs >= zero;
  return { rot: Math.round(best * 100) / 100, ratio: Math.round(ratio * 100) / 100, share: Math.round(share * 100) / 100, ok };
};

const loadImg = src => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(Error('이미지를 읽지 못했어요.')); im.src = src; });
/* 사진 p({data,w,h}) → 기울기. 원본 사진(보정 전)으로 재므로 몇 번을 눌러도 같은 값이 나와요 */
KK.photoTilt = async p => {
  const im = await loadImg(p.data), sc = Math.min(1, 800 / Math.max(im.naturalWidth, im.naturalHeight));
  const w = Math.max(8, Math.round(im.naturalWidth * sc)), h = Math.max(8, Math.round(im.naturalHeight * sc));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(im, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data, g = new Uint8Array(w * h);
  for (let i = 0; i < g.length; i++) g[i] = (d[i * 4] * 299 + d[i * 4 + 1] * 587 + d[i * 4 + 2] * 114) / 1000;
  return KK.detectTilt(g, w, h);
};
})();
