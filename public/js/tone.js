/* 사진 색톤 조절 — 라이트룸 기본 패널처럼 노출·대비·하이라이트·섀도·흰색·검은색·색온도·색조·활기·채도·명료도·선명하게
   모든 값은 -100~+100 (0 = 그대로). 사진 픽셀(RGBA)을 직접 계산해요.
   · 노출·색온도·색조는 색 채널에 곱하는 값, 대비·밝은/어두운 영역·흰색·검은색은 "밝기 → 얼마나 바꿀지" 곡선 하나로 계산(색 비율은 유지),
     채도·활기는 회색과의 거리, 명료도·선명하게는 흐린 사진과의 차이를 더하는 방식이에요. */
(() => {
'use strict';
const KK = window.KK;

KK.TONE_KEYS = ['ex', 'ct', 'hl', 'sh', 'wh', 'bk', 'tp', 'tn', 'vb', 'sa', 'cl', 'sp'];
KK.hasTone = a => !!a && KK.TONE_KEYS.some(k => a[k]);
KK.toneKey = a => KK.TONE_KEYS.map(k => (a && a[k]) || 0).join(',');

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const sstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

/* 밝기(0~2) → 곱할 비율. 어두운 영역·밝은 영역·흰색·검은색·대비를 한 곡선으로 */
function gainCurve(a) {
  const N = 2048, lut = new Float32Array(N);
  const hl = (a.hl || 0) / 100, sh = (a.sh || 0) / 100, wh = (a.wh || 0) / 100, bk = (a.bk || 0) / 100, ct = (a.ct || 0) / 100;
  let prev = 0;
  for (let i = 0; i < N; i++) {
    const y = i / (N / 2);                                                       // 0 ~ 2
    let o = y;
    o += 0.32 * sh * sstep(0, 0.14, y) * (1 - sstep(0.14, 0.72, y));              // 어두운 영역 (완전 검정은 건드리지 않음)
    o += 0.32 * hl * sstep(0.38, 0.95, y);                                       // 밝은 영역
    o += 0.20 * wh * sstep(0.62, 1.05, y);                                       // 흰색
    o += 0.18 * bk * (1 - sstep(0, 0.38, y));                                    // 검은색
    o = 0.5 + (o - 0.5) * (ct >= 0 ? 1 + 0.9 * ct : 1 + 0.7 * ct);              // 대비 (가운데 기준)
    if (o < prev) o = prev;                                                      // 곡선이 거꾸로 가지 않게
    prev = o; lut[i] = o;
  }
  const g = new Float32Array(N);
  for (let i = 0; i < N; i++) { const y = i / (N / 2); g[i] = y < 1e-3 ? 1 : clamp(Math.max(lut[i], 0) / y, 0, 6); }
  return g;
}

/* 흐림(상자 평균) — 가로·세로 3번씩 돌려서 가우시안과 비슷하게. src(Float32 w×h)는 그대로 두고 새 배열을 돌려줘요 */
function blur(src, w, h, r) {
  let a = Float32Array.from(src); const b = new Float32Array(w * h);
  const pass = (from, to, horizontal) => {
    const len = horizontal ? w : h, lines = horizontal ? h : w, stepIn = horizontal ? 1 : w, stepLine = horizontal ? w : 1, d = 2 * r + 1;
    for (let l = 0; l < lines; l++) {
      const base = l * stepLine; let sum = 0;
      for (let k = -r; k <= r; k++) sum += from[base + clamp(k, 0, len - 1) * stepIn];
      for (let k = 0; k < len; k++) {
        to[base + k * stepIn] = sum / d;
        sum += from[base + clamp(k + r + 1, 0, len - 1) * stepIn] - from[base + clamp(k - r, 0, len - 1) * stepIn];
      }
    }
  };
  for (let n = 0; n < 3; n++) { pass(a, b, true); pass(b, a, false); }
  return a;
}

/* d: Uint8ClampedArray(RGBA, w×h) 를 제자리에서 바꿉니다. a: {ex,ct,hl,sh,wh,bk,tp,tn,vb,sa,cl,sp} */
KK.toneApply = (d, w, h, a) => {
  if (!KK.hasTone(a)) return d;
  const ev = Math.pow(2, ((a.ex || 0) / 100) * 2 / 2.2);                         // 노출 ±100 = ±2단계 (감마 공간 근사)
  const tp = (a.tp || 0) / 100, tn = (a.tn || 0) / 100;
  let gr = 1 + 0.30 * tp, gb = 1 - 0.30 * tp, gg = 1 - 0.18 * tn;                // 색온도(+노랑) · 색조(+자주)
  gr *= 1 + 0.05 * tn; gb *= 1 + 0.05 * tn;
  const lum = 0.299 * gr + 0.587 * gg + 0.114 * gb; gr = gr / lum * ev; gg = gg / lum * ev; gb = gb / lum * ev;
  const curve = (a.ct || a.hl || a.sh || a.wh || a.bk) ? gainCurve(a) : null, NC = 2048;
  const sat = 1 + (a.sa || 0) / 100, vib = (a.vb || 0) / 100, doSat = !!(a.sa || a.vb);
  const n = w * h, needDetail = !!(a.cl || a.sp);
  const Y = needDetail ? new Float32Array(n) : null;
  const ySc = (NC / 2) / 255, vibK = vib > 0 ? 1 : 0.6;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    let r = d[p] * gr, g = d[p + 1] * gg, b = d[p + 2] * gb;
    if (curve) {
      let ix = ((0.299 * r + 0.587 * g + 0.114 * b) * ySc) | 0; if (ix > NC - 1) ix = NC - 1;
      const k = curve[ix]; r *= k; g *= k; b *= k;
    }
    if (doSat) {
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      let mx = r > g ? r : g; if (b > mx) mx = b;
      let mn = r < g ? r : g; if (b < mn) mn = b;
      const s = mx > 1 ? (mx - mn) / mx : 0;
      let f = sat * (1 + vib * (1 - (s > 1 ? 1 : s)) * vibK); if (f < 0) f = 0;
      r = l + (r - l) * f; g = l + (g - l) * f; b = l + (b - l) * f;
    }
    d[p] = r; d[p + 1] = g; d[p + 2] = b;                                         // (Uint8ClampedArray 가 0~255 로 잘라 줘요)
    if (Y) Y[i] = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
  }
  if (needDetail) {
    const apply = (blurred, amount, mid) => {
      for (let i = 0, p = 0; i < n; i++, p += 4) {
        const y = Y[i] / 255, m = mid ? 4 * y * (1 - y) : 1, dt = (Y[i] - blurred[i]) * amount * m;
        d[p] += dt; d[p + 1] += dt; d[p + 2] += dt;
      }
    };
    if (a.cl) apply(blur(Y, w, h, Math.max(8, Math.round(Math.min(w, h) / 40))), (a.cl / 100) * 0.9, true);   // 명료도: 큰 반경, 중간 밝기 위주
    if (a.sp) { for (let i = 0, p = 0; i < n; i++, p += 4) Y[i] = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2]; apply(blur(Y, w, h, Math.max(1, Math.min(3, Math.round(Math.min(w, h) / 700)))), (a.sp / 100) * 1.1, false); }   // 선명하게: 작은 반경
  }
  return d;
};

/* ── 자동 톤 ── 사진의 밝기 분포·색 쏠림을 보고 슬라이더 값을 제안해요 (조심스럽게: 크게 바꾸지 않아요)
   opt.tone: 노출·대비·밝은/어두운 영역·흰색·검은색  /  opt.wb: 색온도·색조 */
KK.autoToneAdj = (d, w, h, opt = {}) => {
  const doTone = opt.tone !== false, doWb = opt.wb !== false;
  const hist = new Float32Array(256), step = Math.max(1, Math.floor(Math.sqrt(w * h / 60000)));
  let cnt = 0, sr = 0, sg = 0, sb = 0, nn = 0;
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) {
    const p = (y * w + x) * 4, r = d[p], g = d[p + 1], b = d[p + 2], yy = 0.299 * r + 0.587 * g + 0.114 * b;
    hist[Math.min(255, yy | 0)]++; cnt++;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (yy > 50 && yy < 225 && mx > 0 && (mx - mn) / mx < 0.35) { sr += r; sg += g; sb += b; nn++; }     // 색이 옅은(회색에 가까운) 중간 밝기 점만
  }
  const pct = q => { let acc = 0; const t = q * cnt; for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= t) return i / 255; } return 1; };
  const out = {}, p1 = pct(0.01), p50 = pct(0.5), p99 = pct(0.99);
  if (doTone) {
    // 어두우면 중간 밝기가 0.5 가 되도록 올리고, 아주 밝을 때만(0.78 넘음) 조금 내려요 — 밝고 화사한 인테리어 사진을 어둡게 만들지 않도록
    let gain = 1; if (p50 < 0.5) gain = clamp(0.50 / Math.max(p50, 0.05), 1, 2.2); else if (p50 > 0.78) gain = clamp(0.72 / p50, 0.8, 1);
    let ex = Math.abs(gain - 1) < 0.07 ? 0 : clamp((2.2 * Math.log2(gain) / 2) * 100, -20, 50);
    const g2 = Math.pow(2, (ex / 100) * 2 / 2.2), p99g = p99 * g2, p1g = p1 * g2;
    let below = 0, above = 0; for (let i = 0; i < 256; i++) { const v = (i / 255) * g2; if (v < 0.22) below += hist[i]; if (v > 0.95) above += hist[i]; }
    out.ex = Math.round(ex);
    out.hl = above / cnt > 0.06 ? -Math.round(clamp(20 + (above / cnt) * 150, 0, 60)) : 0;
    out.wh = p99g < 0.92 ? Math.round(clamp((0.96 - p99g) * 150, 0, 35)) : 0;
    out.bk = p1g > 0.05 ? -Math.round(clamp((p1g - 0.03) * 250, 0, 35)) : 0;
    out.sh = below / cnt > 0.30 ? Math.round(clamp((below / cnt) * 60, 0, 35)) : 0;
    const spread = p99g - p1g; out.ct = spread < 0.8 ? Math.round(clamp((0.85 - spread) * 60, 0, 20)) : 0;
  }
  if (doWb && nn > cnt * 0.05) {
    const R = sr / nn, G = sg / nn, B = sb / nn;
    out.tp = Math.round(clamp(((B - R) / (0.3 * (B + R))) * 0.6 * 100, -25, 25));                    // 따뜻하게 쏠렸으면 −(차갑게), 푸르게 쏠렸으면 +
    out.tn = Math.round(clamp(((1 - ((R + B) / 2) / G) / 0.18) * 0.6 * 100, -15, 15));              // 초록 쏠림이면 +(자주 쪽으로)
  }
  return out;
};

/* 사진의 색 쏠림·밝기를 간단히 재어 보여 주는 통계 (테스트·안내용) */
KK.toneStats = (d, w, h) => {
  const step = Math.max(1, Math.floor(Math.sqrt(w * h / 60000))); let n = 0, y = 0, r = 0, g = 0, b = 0; const ys = [];
  for (let j = 0; j < h; j += step) for (let i = 0; i < w; i += step) { const p = (j * w + i) * 4; r += d[p]; g += d[p + 1]; b += d[p + 2]; const yy = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2]; y += yy; ys.push(yy); n++; }
  ys.sort((a, b2) => a - b2);
  return { y: y / n, r: r / n, g: g / n, b: b / n, p1: ys[Math.floor(n * 0.01)], p50: ys[Math.floor(n * 0.5)], p99: ys[Math.min(n - 1, Math.floor(n * 0.99))] };
};
})();
