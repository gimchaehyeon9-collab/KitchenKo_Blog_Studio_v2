// 사진 수직·수평 보정 (라이트룸 '변환/Upright' 와 비슷하게)
//
// 화면(미리보기)과 서버(원본 저장)가 이 파일 하나를 같이 쓴다 → 미리보기와 결과가 똑같다.
//   - 세부 조정: 회전(°), 수직 원근, 수평 원근 (−100~100). 빈 모서리가 안 보이게 자동으로 확대해 자른다.
//   - 자동: 사진 속 벽 모서리·문틀·창틀 같은 세로선/가로선을 찾아 기울기와 원근을 계산한다.
//       auto     — 회전 + 수직 원근 70% (과하게 펴지 않는 균형형)
//       vertical — 회전 + 수직 원근 100% (세로선을 완전히 세운다)
//       level    — 회전만 (수평 맞추기)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Straighten = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var P_MAX = 0.5; // 원근 슬라이더 100 = 원근 계수 0.5
  var LIMIT = { rotate: 15, vertical: 100, horizontal: 100 };

  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

  /** 값 정리. 모두 0 이면 보정 없음. */
  function normalize(a) {
    a = a || {};
    return {
      rotate: Math.round(clamp(Number(a.rotate) || 0, -LIMIT.rotate, LIMIT.rotate) * 100) / 100,
      vertical: Math.round(clamp(Number(a.vertical) || 0, -LIMIT.vertical, LIMIT.vertical) * 10) / 10,
      horizontal: Math.round(clamp(Number(a.horizontal) || 0, -LIMIT.horizontal, LIMIT.horizontal) * 10) / 10,
    };
  }
  function isIdentity(a) { a = normalize(a); return !a.rotate && !a.vertical && !a.horizontal; }

  // ── 3×3 행렬 ──
  function mul(A, B) {
    var C = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) C[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
    return C;
  }
  function inv(m) {
    var a = m[0], b = m[1], c = m[2], d = m[3], e = m[4], f = m[5], g = m[6], h = m[7], i = m[8];
    var A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
    var det = a * A + b * B + c * C;
    return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
  }
  function apply(H, x, y) {
    var w = H[6] * x + H[7] * y + H[8];
    return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
  }

  /**
   * 원본 → 결과 변환 (가운데 원점, 긴 변 절반 = 1 인 좌표).
   * 회전(시계 방향 +) 후 원근: 수직 원근 + 면 위쪽이 넓어진다(위로 모이는 세로선을 편다).
   */
  function forward(a) {
    a = normalize(a);
    var r = (a.rotate * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
    var R = [c, -s, 0, s, c, 0, 0, 0, 1];
    var p = (a.vertical / 100) * P_MAX, q = (a.horizontal / 100) * P_MAX;
    var K = [1, 0, 0, 0, 1, 0, q, p, 1];
    return mul(K, R);
  }

  /** 빈 모서리가 보이지 않도록 필요한 확대 배율 (결과 틀을 가운데 기준으로 줄여 원본 안에 들어오게). */
  function cropZoom(a, W, H) {
    if (isIdentity(a)) return 1;
    var S = Math.max(W, H) / 2, hx = W / 2 / S, hy = H / 2 / S;
    var Hi = inv(forward(a));
    var fits = function (z) {
      var pts = [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy], [0, -hy], [0, hy], [-hx, 0], [hx, 0]];
      for (var k = 0; k < pts.length; k++) {
        var s = apply(Hi, pts[k][0] / z, pts[k][1] / z);
        if (!(Math.abs(s[0]) <= hx + 1e-9 && Math.abs(s[1]) <= hy + 1e-9)) return false;
      }
      return true;
    };
    var lo = 1, hi = 4;
    if (!fits(hi)) return hi;
    for (var it = 0; it < 30; it++) { var m = (lo + hi) / 2; if (fits(m)) hi = m; else lo = m; }
    return hi;
  }

  /**
   * 보정한 그림을 만든다. src/dst 는 가로 W × 세로 H × channels 바이트 배열(같은 크기).
   * 쌍선형 보간. 화면(캔버스 RGBA)과 서버(sharp raw RGB)에서 같이 쓴다.
   */
  function render(src, W, H, channels, a, dst) {
    dst = dst || new Uint8ClampedArray(W * H * channels);
    if (isIdentity(a)) { dst.set(src); return dst; }
    var S = Math.max(W, H) / 2, z = cropZoom(a, W, H);
    var Hi = inv(forward(a));
    // 결과 픽셀 (x,y) → 정규화 → 원본 정규화 → 원본 픽셀. 한 줄 안에서 x 에 대해 선형이라 더해 가며 계산한다.
    var k = 1 / (S * z), cx = W / 2, cy = H / 2;
    var ax = Hi[0] * k, bx = Hi[3] * k, wx = Hi[6] * k;
    for (var y = 0; y < H; y++) {
      var ny = (y + 0.5 - cy) * k;
      var nx0 = (0.5 - cx) * k;
      var X = Hi[0] * nx0 + Hi[1] * ny + Hi[2];
      var Y = Hi[3] * nx0 + Hi[4] * ny + Hi[5];
      var Wt = Hi[6] * nx0 + Hi[7] * ny + Hi[8];
      var o = y * W * channels;
      for (var x = 0; x < W; x++, X += ax, Y += bx, Wt += wx, o += channels) {
        var sx = (X / Wt) * S + cx - 0.5, sy = (Y / Wt) * S + cy - 0.5;
        if (sx < 0) sx = 0; else if (sx > W - 1) sx = W - 1;
        if (sy < 0) sy = 0; else if (sy > H - 1) sy = H - 1;
        var x0 = sx | 0, y0 = sy | 0, x1 = x0 < W - 1 ? x0 + 1 : x0, y1 = y0 < H - 1 ? y0 + 1 : y0;
        var fx = sx - x0, fy = sy - y0;
        var i00 = (y0 * W + x0) * channels, i10 = (y0 * W + x1) * channels, i01 = (y1 * W + x0) * channels, i11 = (y1 * W + x1) * channels;
        for (var c = 0; c < channels; c++) {
          var t = src[i00 + c] + (src[i10 + c] - src[i00 + c]) * fx;
          var b = src[i01 + c] + (src[i11 + c] - src[i01 + c]) * fx;
          dst[o + c] = t + (b - t) * fy + 0.5;
        }
      }
    }
    return dst;
  }

  // ─────────────────────────────────────────────
  // 자동: 선 찾기
  // ─────────────────────────────────────────────

  /** 회색조 그림에서 '세로에 가까운' 직선을 찾는다. 돌려주는 값: [{ t: dx/dy 기울기, x0: 가운데 줄에서의 x, votes }] */
  function findLines(g, W, H) {
    // 소벨 경계
    var n = W * H, gx = new Float32Array(n), gy = new Float32Array(n), mag = new Float32Array(n);
    for (var y = 1; y < H - 1; y++) for (var x = 1; x < W - 1; x++) {
      var i = y * W + x;
      var a = g[i - W - 1], b = g[i - W], c = g[i - W + 1], d = g[i - 1], f = g[i + 1], h = g[i + W - 1], k = g[i + W], l = g[i + W + 1];
      gx[i] = c + 2 * f + l - a - 2 * d - h;
      gy[i] = h + 2 * k + l - a - 2 * b - c;
      mag[i] = Math.abs(gx[i]) + Math.abs(gy[i]);
    }
    // 강한 경계만 (상위 12% 이면서 일정 세기 이상)
    var sample = [];
    for (var s = 0; s < n; s += 7) sample.push(mag[s]);
    sample.sort(function (p, q) { return p - q; });
    var T = Math.max(60, sample[Math.floor(sample.length * 0.88)] || 0);

    var A_MAX = 25, STEP = 0.25, NA = Math.round((2 * A_MAX) / STEP) + 1;
    var tans = new Float32Array(NA);
    for (var ai = 0; ai < NA; ai++) tans[ai] = Math.tan(((-A_MAX + ai * STEP) * Math.PI) / 180);
    var NX = 3 * W, acc = new Uint16Array(NA * NX), cy = H / 2;
    var gate = Math.tan(((A_MAX + 5) * Math.PI) / 180);
    for (var yy = 1; yy < H - 1; yy++) for (var xx = 1; xx < W - 1; xx++) {
      var j = yy * W + xx;
      if (mag[j] < T) continue;
      var ax = Math.abs(gx[j]), ay = Math.abs(gy[j]);
      if (ay > ax * gate) continue; // 세로선의 경계는 가로 방향 기울기가 크다
      // 경계 방향(선 방향)에 가까운 각도에만 투표한다 (±6°)
      var dir = ax > 0 ? (-gy[j] / gx[j]) : 0; // 선의 dx/dy
      var aDir = (Math.atan(dir) * 180) / Math.PI;
      var lo = Math.max(0, Math.floor((aDir - 6 + A_MAX) / STEP)), hi = Math.min(NA - 1, Math.ceil((aDir + 6 + A_MAX) / STEP));
      for (var q = lo; q <= hi; q++) {
        var x0 = Math.round(xx - (yy - cy) * tans[q]) + W;
        if (x0 >= 0 && x0 < NX) acc[q * NX + x0]++;
      }
    }
    // 봉우리 찾기
    var minVotes = Math.max(15, H * 0.18), peaks = [];
    for (var qa = 0; qa < NA; qa++) for (var xb = 1; xb < NX - 1; xb++) {
      var v = acc[qa * NX + xb];
      if (v < minVotes) continue;
      var isMax = true;
      for (var da = -4; da <= 4 && isMax; da++) for (var dx = -5; dx <= 5; dx++) {
        var qq = qa + da, xq = xb + dx;
        if (qq < 0 || qq >= NA || xq < 0 || xq >= NX || (!da && !dx)) continue;
        var w2 = acc[qq * NX + xq];
        if (w2 > v || (w2 === v && (da < 0 || (da === 0 && dx < 0)))) { isMax = false; break; }
      }
      if (isMax) peaks.push({ t: tans[qa], x0: xb - W, votes: v });
    }
    peaks.sort(function (p, q) { return q.votes - p.votes; });
    // 거의 같은 선 중복 제거
    var out = [];
    for (var pi = 0; pi < peaks.length && out.length < 30; pi++) {
      var P = peaks[pi], dup = false;
      for (var oi = 0; oi < out.length; oi++) if (Math.abs(out[oi].x0 - P.x0) < W * 0.015 && Math.abs(out[oi].t - P.t) < 0.04) { dup = true; break; }
      // 그림 밖에서 만나는 선(가운데 줄이 화면 밖)은 제외
      if (!dup && P.x0 > -W * 0.1 && P.x0 < W * 1.1) out.push(P);
    }
    return out;
  }

  function transpose(g, W, H) {
    var t = new Uint8Array(W * H);
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) t[x * H + y] = g[y * W + x];
    return t;
  }

  function weightedMedian(vals, ws) {
    var idx = vals.map(function (_, i) { return i; }).sort(function (a, b) { return vals[a] - vals[b]; });
    var total = ws.reduce(function (s, w) { return s + w; }, 0), run = 0;
    for (var k = 0; k < idx.length; k++) { run += ws[idx[k]]; if (run >= total / 2) return vals[idx[k]]; }
    return 0;
  }

  /**
   * 자동 보정값을 구한다.
   *   g    — 회색조 Uint8 (가로 W × 세로 H). 긴 변 600~1000px 정도로 줄인 그림이면 충분하다.
   *   mode — 'auto' | 'vertical' | 'level'
   * 돌려주는 값: { rotate, vertical, horizontal, lines, ok, reason }
   */
  function detect(g, W, H, mode) {
    mode = mode || 'auto';
    var S = Math.max(W, H) / 2;
    var lines = findLines(g, W, H);
    var res = { rotate: 0, vertical: 0, horizontal: 0, lines: lines.length, ok: false, reason: '' };

    if (lines.length >= 2) {
      // 세로선: dx/dy = a + b·X0  (a → 회전, b → 수직 원근)
      var X = lines.map(function (l) { return (l.x0 - W / 2) / S; });
      var T = lines.map(function (l) { return l.t; });
      var Wt = lines.map(function (l) { return l.votes; });
      var use = lines.map(function () { return true; });
      var a = weightedMedian(T, Wt), b = 0;
      for (var it = 0; it < 3; it++) {
        var sw = 0, sx = 0, st = 0, sxx = 0, sxt = 0;
        for (var i = 0; i < lines.length; i++) if (use[i]) { sw += Wt[i]; sx += Wt[i] * X[i]; st += Wt[i] * T[i]; sxx += Wt[i] * X[i] * X[i]; sxt += Wt[i] * X[i] * T[i]; }
        var varX = sxx / sw - (sx / sw) * (sx / sw);
        // 수평만(level) 이어도 원근 성분(b)을 같이 구해야 가운데 기준 기울기(a)가 정확하다. 적용만 회전으로 한다.
        if (varX > 0.02) {
          b = (sxt / sw - (sx / sw) * (st / sw)) / varX;
          a = st / sw - b * (sx / sw);
        } else {
          b = 0;
          a = weightedMedian(T.filter(function (_, k) { return use[k]; }), Wt.filter(function (_, k) { return use[k]; }));
        }
        // 크게 벗어난 선(사선 가구·그림자 등)은 빼고 다시
        for (var j = 0; j < lines.length; j++) use[j] = Math.abs(T[j] - (a + b * X[j])) < 0.035;
        if (use.filter(Boolean).length < 2) break;
      }
      res.rotate = (Math.atan(a) * 180) / Math.PI;
      var kv = mode === 'vertical' ? 1 : mode === 'auto' ? 0.7 : 0;
      res.vertical = ((b * kv) / P_MAX) * 100;
      res.ok = true;
    } else {
      // 세로선이 없으면 가로선으로 수평만 맞춘다. 가로선 dy/dx = m → 회전 −atan(m)
      var tg = transpose(g, W, H);
      var hl = findLines(tg, H, W);
      if (hl.length >= 1) {
        res.rotate = (-Math.atan(weightedMedian(hl.map(function (l) { return l.t; }), hl.map(function (l) { return l.votes; }))) * 180) / Math.PI;
        res.ok = true;
        res.reason = '세로선이 부족해 가로선으로 수평만 맞췄습니다.';
      } else {
        res.reason = '기준이 될 직선(벽 모서리·문틀·창틀)을 찾지 못했습니다. 직접 조정해 주세요.';
      }
    }
    // 아주 작은 값은 0 으로 (노이즈), 범위 제한
    if (Math.abs(res.rotate) < 0.15) res.rotate = 0;
    if (Math.abs(res.vertical) < 2) res.vertical = 0;
    res.rotate = clamp(res.rotate, -10, 10);
    var n = normalize(res);
    res.rotate = n.rotate; res.vertical = n.vertical;
    return res;
  }

  /** RGBA/RGB 바이트 → 회색조 Uint8 */
  function gray(src, W, H, channels) {
    var g = new Uint8Array(W * H);
    for (var i = 0, j = 0; i < W * H; i++, j += channels) g[i] = (src[j] * 77 + src[j + 1] * 150 + src[j + 2] * 29) >> 8;
    return g;
  }

  return { normalize: normalize, isIdentity: isIdentity, forward: forward, cropZoom: cropZoom, render: render, detect: detect, gray: gray, findLines: findLines, LIMIT: LIMIT };
});
