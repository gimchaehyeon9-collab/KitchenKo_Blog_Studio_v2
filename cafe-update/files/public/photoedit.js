// 사진 보정 도구 모음 — 밝기·색(톤) / 모자이크 / 선 그어 수직·수평 맞추기(라이트룸 '가이드 업라이트' 같은 도우미)
//
// 화면(보정 창)과 서버(원본 크기로 저장)가 이 파일 하나를 같이 쓴다 → 미리보기와 결과가 똑같다.
// straighten.js 와 짝이다. 처리 순서는 항상  ① 모자이크(원본 위치 기준) → ② 수직·수평 → ③ 밝기·색.
//   · 모자이크는 '원본 사진 속 위치'에 붙는다. 그래서 수직·수평을 나중에 바꿔도 가린 곳이 사람을 따라간다.
//   · 모든 함수는 RGB(3) 또는 RGBA(4) 바이트 배열을 받는다 (channels).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./straighten'));
  else root.PhotoEdit = factory(root.Straighten);
})(typeof self !== 'undefined' ? self : this, function (St) {
  'use strict';

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function sstep(e0, e1, x) { var t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }
  function byte(v) { return v < 0 ? 0 : v > 255 ? 255 : (v + 0.5) | 0; }

  // ─────────────────────────────────────────────
  // 밝기·색 (노출·대비·밝은/어두운 영역·흰색·검정·색온도·색조·생동감·채도·명료도·선명하게)  각 −100~100
  // ─────────────────────────────────────────────
  var TONE_KEYS = ['ex', 'ct', 'hl', 'sh', 'wh', 'bk', 'tp', 'tn', 'vb', 'sa', 'cl', 'sp'];

  /** 값 정리: 0 이 아닌 것만 정수로 남긴다. 모두 0 이면 {} */
  function normTone(a) {
    var out = {};
    if (!a) return out;
    for (var i = 0; i < TONE_KEYS.length; i++) {
      var k = TONE_KEYS[i], v = Math.round(clamp(Number(a[k]) || 0, -100, 100));
      if (v) out[k] = v;
    }
    return out;
  }
  function hasTone(a) { return !!a && TONE_KEYS.some(function (k) { return a[k]; }); }

  // 밝기(0~2) → 곱할 비율. 어두운 영역·밝은 영역·흰색·검정·대비를 한 곡선으로
  function gainCurve(a) {
    var N = 2048, lut = new Float32Array(N);
    var hl = (a.hl || 0) / 100, sh = (a.sh || 0) / 100, wh = (a.wh || 0) / 100, bk = (a.bk || 0) / 100, ct = (a.ct || 0) / 100;
    var prev = 0, i, y, o;
    for (i = 0; i < N; i++) {
      y = i / (N / 2);
      o = y;
      o += 0.32 * sh * sstep(0, 0.14, y) * (1 - sstep(0.14, 0.72, y));
      o += 0.32 * hl * sstep(0.38, 0.95, y);
      o += 0.20 * wh * sstep(0.62, 1.05, y);
      o += 0.18 * bk * (1 - sstep(0, 0.38, y));
      o = 0.5 + (o - 0.5) * (ct >= 0 ? 1 + 0.9 * ct : 1 + 0.7 * ct);
      if (o < prev) o = prev;
      prev = o; lut[i] = o;
    }
    var g = new Float32Array(N);
    for (i = 0; i < N; i++) { y = i / (N / 2); g[i] = y < 1e-3 ? 1 : clamp(Math.max(lut[i], 0) / y, 0, 6); }
    return g;
  }

  // 흐림(상자 평균) — 가로·세로 3번씩 돌려서 가우시안과 비슷하게
  function blur(src, w, h, r) {
    var a = Float32Array.from(src), b = new Float32Array(w * h);
    function pass(from, to, horizontal) {
      var len = horizontal ? w : h, lines = horizontal ? h : w, stepIn = horizontal ? 1 : w, stepLine = horizontal ? w : 1, d = 2 * r + 1;
      for (var l = 0; l < lines; l++) {
        var base = l * stepLine, sum = 0, k;
        for (k = -r; k <= r; k++) sum += from[base + clamp(k, 0, len - 1) * stepIn];
        for (k = 0; k < len; k++) {
          to[base + k * stepIn] = sum / d;
          sum += from[base + clamp(k + r + 1, 0, len - 1) * stepIn] - from[base + clamp(k - r, 0, len - 1) * stepIn];
        }
      }
    }
    for (var n = 0; n < 3; n++) { pass(a, b, true); pass(b, a, false); }
    return a;
  }

  /** d(RGB/RGBA 바이트, w×h)를 제자리에서 바꾼다. a: { ex, ct, hl, sh, wh, bk, tp, tn, vb, sa, cl, sp } */
  function toneApply(d, w, h, ch, a) {
    if (!hasTone(a)) return d;
    var ev = Math.pow(2, ((a.ex || 0) / 100) * 2 / 2.2);
    var tp = (a.tp || 0) / 100, tn = (a.tn || 0) / 100;
    var gr = 1 + 0.30 * tp, gb = 1 - 0.30 * tp, gg = 1 - 0.18 * tn;
    gr *= 1 + 0.05 * tn; gb *= 1 + 0.05 * tn;
    var lum = 0.299 * gr + 0.587 * gg + 0.114 * gb; gr = gr / lum * ev; gg = gg / lum * ev; gb = gb / lum * ev;
    var curve = (a.ct || a.hl || a.sh || a.wh || a.bk) ? gainCurve(a) : null, NC = 2048;
    var sat = 1 + (a.sa || 0) / 100, vib = (a.vb || 0) / 100, doSat = !!(a.sa || a.vb);
    var n = w * h, needDetail = !!(a.cl || a.sp);
    var Y = needDetail ? new Float32Array(n) : null;
    var ySc = (NC / 2) / 255, vibK = vib > 0 ? 1 : 0.6;
    var i, p;
    for (i = 0, p = 0; i < n; i++, p += ch) {
      var r = d[p] * gr, g = d[p + 1] * gg, b = d[p + 2] * gb;
      if (curve) {
        var ix = ((0.299 * r + 0.587 * g + 0.114 * b) * ySc) | 0; if (ix > NC - 1) ix = NC - 1;
        var k = curve[ix]; r *= k; g *= k; b *= k;
      }
      if (doSat) {
        var l = 0.299 * r + 0.587 * g + 0.114 * b;
        var mx = r > g ? r : g; if (b > mx) mx = b;
        var mn = r < g ? r : g; if (b < mn) mn = b;
        var s = mx > 1 ? (mx - mn) / mx : 0;
        var f = sat * (1 + vib * (1 - (s > 1 ? 1 : s)) * vibK); if (f < 0) f = 0;
        r = l + (r - l) * f; g = l + (g - l) * f; b = l + (b - l) * f;
      }
      d[p] = byte(r); d[p + 1] = byte(g); d[p + 2] = byte(b);
      if (Y) Y[i] = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
    }
    if (needDetail) {
      var detail = function (blurred, amount, mid) {
        for (var i2 = 0, p2 = 0; i2 < n; i2++, p2 += ch) {
          var y = Y[i2] / 255, m = mid ? 4 * y * (1 - y) : 1, dt = (Y[i2] - blurred[i2]) * amount * m;
          d[p2] = byte(d[p2] + dt); d[p2 + 1] = byte(d[p2 + 1] + dt); d[p2 + 2] = byte(d[p2 + 2] + dt);
        }
      };
      if (a.cl) detail(blur(Y, w, h, Math.max(8, Math.round(Math.min(w, h) / 40))), (a.cl / 100) * 0.9, true);
      if (a.sp) {
        for (i = 0, p = 0; i < n; i++, p += ch) Y[i] = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
        detail(blur(Y, w, h, Math.max(1, Math.min(3, Math.round(Math.min(w, h) / 700)))), (a.sp / 100) * 1.2, false);
      }
    }
    return d;
  }

  /** 자동 밝기·색 — 사진의 밝기 분포·색 쏠림을 보고 슬라이더 값을 제안한다 (조심스럽게: 크게 바꾸지 않는다). */
  function autoTone(d, w, h, ch, opt) {
    opt = opt || {};
    var doTone = opt.tone !== false, doWb = opt.wb !== false;
    var hist = new Float32Array(256), step = Math.max(1, Math.floor(Math.sqrt(w * h / 60000)));
    var cnt = 0, sr = 0, sg = 0, sb = 0, nn = 0, x, y;
    for (y = 0; y < h; y += step) for (x = 0; x < w; x += step) {
      var p = (y * w + x) * ch, r = d[p], g = d[p + 1], b = d[p + 2], yy = 0.299 * r + 0.587 * g + 0.114 * b;
      hist[Math.min(255, yy | 0)]++; cnt++;
      var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (yy > 50 && yy < 225 && mx > 0 && (mx - mn) / mx < 0.35) { sr += r; sg += g; sb += b; nn++; }
    }
    function pct(q) { var acc = 0, t = q * cnt; for (var i = 0; i < 256; i++) { acc += hist[i]; if (acc >= t) return i / 255; } return 1; }
    var out = {}, p1 = pct(0.01), p50 = pct(0.5), p99 = pct(0.99);
    if (doTone) {
      var gain = 1;
      if (p50 < 0.5) gain = clamp(0.50 / Math.max(p50, 0.05), 1, 2.2); else if (p50 > 0.78) gain = clamp(0.72 / p50, 0.8, 1);
      var ex = Math.abs(gain - 1) < 0.07 ? 0 : clamp((2.2 * Math.log2(gain) / 2) * 100, -20, 50);
      var g2 = Math.pow(2, (ex / 100) * 2 / 2.2), p99g = p99 * g2, p1g = p1 * g2;
      var below = 0, above = 0;
      for (var i = 0; i < 256; i++) { var v = (i / 255) * g2; if (v < 0.22) below += hist[i]; if (v > 0.95) above += hist[i]; }
      out.ex = Math.round(ex);
      out.hl = above / cnt > 0.06 ? -Math.round(clamp(20 + (above / cnt) * 150, 0, 60)) : 0;
      out.wh = p99g < 0.92 ? Math.round(clamp((0.96 - p99g) * 150, 0, 35)) : 0;
      out.bk = p1g > 0.05 ? -Math.round(clamp((p1g - 0.03) * 250, 0, 35)) : 0;
      out.sh = below / cnt > 0.30 ? Math.round(clamp((below / cnt) * 60, 0, 35)) : 0;
      var spread = p99g - p1g; out.ct = spread < 0.8 ? Math.round(clamp((0.85 - spread) * 60, 0, 20)) : 0;
    }
    if (doWb && nn > cnt * 0.05) {
      var R = sr / nn, G = sg / nn, B = sb / nn;
      out.tp = Math.round(clamp(((B - R) / (0.3 * (B + R))) * 0.6 * 100, -25, 25));
      out.tn = Math.round(clamp(((1 - ((R + B) / 2) / G) / 0.18) * 0.6 * 100, -15, 15));
    }
    return out;
  }

  // ─────────────────────────────────────────────
  // 모자이크 — 원본 사진 속 위치(0~1 비율 좌표)로 저장한다.
  //   shapes: [{ t:'poly', pts:[[u,v],…] }  (사각형도 꼭짓점 4개짜리 poly)
  //            { t:'brush', pts:[[u,v],…], r }  (r = 붓 반지름, 긴 변에 대한 비율) ]
  //   size  : 1~5 (모자이크 칸 크기. 클수록 거칠다)
  // ─────────────────────────────────────────────
  var MOSAIC_FRAC = [0.010, 0.014, 0.020, 0.028, 0.040];
  var MAX_SHAPES = 60, MAX_PTS = 400;

  function normMosaic(m) {
    var out = { size: 3, shapes: [] };
    if (!m) return out;
    out.size = Math.round(clamp(Number(m.size) || 3, 1, 5));
    (Array.isArray(m.shapes) ? m.shapes : []).slice(0, MAX_SHAPES).forEach(function (s) {
      if (!s || !Array.isArray(s.pts)) return;
      var pts = s.pts.slice(0, MAX_PTS).map(function (q) {
        return [Math.round(clamp(Number(q && q[0]) || 0, -0.5, 1.5) * 10000) / 10000, Math.round(clamp(Number(q && q[1]) || 0, -0.5, 1.5) * 10000) / 10000];
      });
      if (s.t === 'brush') {
        if (pts.length >= 1) out.shapes.push({ t: 'brush', pts: pts, r: Math.round(clamp(Number(s.r) || 0.03, 0.004, 0.3) * 10000) / 10000 });
      } else if (pts.length >= 3) {
        out.shapes.push({ t: 'poly', pts: pts });
      }
    });
    return out;
  }
  function hasMosaic(m) { return !!m && Array.isArray(m.shapes) && m.shapes.length > 0; }

  // 칠한 곳 마스크 (1 = 가림)
  function mosaicMask(W, H, shapes) {
    var mask = new Uint8Array(W * H), M = Math.max(W, H);
    shapes.forEach(function (s) {
      var i;
      if (s.t === 'brush') {
        var rad = Math.max(1, s.r * M), pts = s.pts.map(function (q) { return [q[0] * W, q[1] * H]; });
        var stamp = function (cx, cy) {
          var y0 = Math.max(0, Math.floor(cy - rad)), y1 = Math.min(H - 1, Math.ceil(cy + rad));
          for (var y = y0; y <= y1; y++) {
            var dy = y + 0.5 - cy, half = Math.sqrt(Math.max(0, rad * rad - dy * dy));
            var x0 = Math.max(0, Math.floor(cx - half)), x1 = Math.min(W - 1, Math.ceil(cx + half));
            for (var x = x0; x <= x1; x++) mask[y * W + x] = 1;
          }
        };
        stamp(pts[0][0], pts[0][1]);
        for (i = 1; i < pts.length; i++) {
          var ax = pts[i - 1][0], ay = pts[i - 1][1], bx = pts[i][0], by = pts[i][1];
          var dist = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(dist / Math.max(1, rad * 0.4)));
          for (var t = 1; t <= n; t++) stamp(ax + ((bx - ax) * t) / n, ay + ((by - ay) * t) / n);
        }
      } else {
        // 다각형 채우기 (짝-홀 규칙, 한 줄씩)
        var P = s.pts.map(function (q) { return [q[0] * W, q[1] * H]; });
        var minY = Infinity, maxY = -Infinity;
        P.forEach(function (q) { if (q[1] < minY) minY = q[1]; if (q[1] > maxY) maxY = q[1]; });
        for (var y = Math.max(0, Math.floor(minY)); y <= Math.min(H - 1, Math.ceil(maxY)); y++) {
          var yc = y + 0.5, xs = [];
          for (i = 0; i < P.length; i++) {
            var p = P[i], q2 = P[(i + 1) % P.length];
            if ((p[1] <= yc && q2[1] > yc) || (q2[1] <= yc && p[1] > yc)) xs.push(p[0] + ((yc - p[1]) / (q2[1] - p[1])) * (q2[0] - p[0]));
          }
          xs.sort(function (a, b) { return a - b; });
          for (i = 0; i + 1 < xs.length; i += 2) {
            var xa = Math.max(0, Math.round(xs[i])), xb = Math.min(W - 1, Math.round(xs[i + 1]) - 1);
            for (var x = xa; x <= xb; x++) mask[y * W + x] = 1;
          }
        }
      }
    });
    return mask;
  }

  /** 모자이크 적용 (제자리). 칠한 곳이 한 픽셀이라도 닿은 칸은 통째로 평균색 한 덩어리가 된다 → 반드시 가려진다. */
  function mosaicApply(d, W, H, ch, m) {
    m = normMosaic(m);
    if (!m.shapes.length) return d;
    var mask = mosaicMask(W, H, m.shapes);
    var bs = Math.max(6, Math.round(Math.max(W, H) * MOSAIC_FRAC[m.size - 1]));
    for (var by = 0; by < H; by += bs) {
      var y1 = Math.min(H, by + bs);
      for (var bx = 0; bx < W; bx += bs) {
        var x1 = Math.min(W, bx + bs), hit = false, y, x;
        for (y = by; y < y1 && !hit; y++) for (x = bx; x < x1; x++) if (mask[y * W + x]) { hit = true; break; }
        if (!hit) continue;
        var sr = 0, sg = 0, sb = 0, n = 0;
        for (y = by; y < y1; y++) for (x = bx; x < x1; x++) { var p = (y * W + x) * ch; sr += d[p]; sg += d[p + 1]; sb += d[p + 2]; n++; }
        var R = byte(sr / n), G = byte(sg / n), B = byte(sb / n);
        for (y = by; y < y1; y++) for (x = bx; x < x1; x++) { var q = (y * W + x) * ch; d[q] = R; d[q + 1] = G; d[q + 2] = B; }
      }
    }
    return d;
  }

  // ─────────────────────────────────────────────
  // 좌표 변환 (보정한 그림 ↔ 원본)
  // ─────────────────────────────────────────────
  function inv3(m) {
    var a = m[0], b = m[1], c = m[2], d = m[3], e = m[4], f = m[5], g = m[6], h = m[7], i = m[8];
    var A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
    var det = a * A + b * B + c * C;
    return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
  }

  /** 보정한 그림 위의 한 점 (x, y: 픽셀 좌표) → 원본 사진 위의 같은 점 (같은 W×H 기준 픽셀 좌표) */
  function mapToSource(a, W, H, x, y) {
    if (St.isIdentity(a)) return [x, y];
    var S = Math.max(W, H) / 2, z = St.cropZoom(a, W, H), Hi = inv3(St.forward(a));
    var k = 1 / (S * z), cx = W / 2, cy = H / 2;
    var nx = (x - cx) * k, ny = (y - cy) * k;
    var X = Hi[0] * nx + Hi[1] * ny + Hi[2], Y = Hi[3] * nx + Hi[4] * ny + Hi[5], Wt = Hi[6] * nx + Hi[7] * ny + Hi[8];
    return [(X / Wt) * S + cx, (Y / Wt) * S + cy];
  }

  // ─────────────────────────────────────────────
  // 선 그어 맞추기 (도우미) — 사용자가 '원본 사진 위에' 그은 선들이 세로/가로가 되도록 회전·수직 원근·수평 원근을 구한다.
  //   lines: [{ k:'v'|'h', x1, y1, x2, y2 }]  (원본 사진 픽셀 좌표, 사진 크기 W×H)
  //   · 세로선(k:'v'): 벽 모서리·문틀처럼 똑바로 서 있어야 하는 선
  //   · 가로선(k:'h'): 창틀·몰딩·바닥선처럼 수평이어야 하는 선
  //   선이 1개면 회전만, 세로선 2개 이상이면 수직 원근까지, 가로선 2개 이상이면 수평 원근까지 맞춘다.
  // ─────────────────────────────────────────────
  var P_MAX = 0.5;   // straighten.js 의 원근 계수 (슬라이더 100 = 0.5)
  function fwd(a) {
    var r = (a.rotate * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
    var p = (a.vertical / 100) * P_MAX, q = (a.horizontal / 100) * P_MAX;
    // K · R  (straighten.js 의 forward 와 같은 식)
    return [c, -s, 0, s, c, 0, q * c + p * s, -q * s + p * c, 1];
  }
  function lineErrors(H3, lines, W, H) {
    var S = Math.max(W, H) / 2, cx = W / 2, cy = H / 2;
    return lines.map(function (l) {
      var P = [[(l.x1 - cx) / S, (l.y1 - cy) / S], [(l.x2 - cx) / S, (l.y2 - cy) / S]];
      var Q = P.map(function (q) {
        var w = H3[6] * q[0] + H3[7] * q[1] + H3[8];
        return [(H3[0] * q[0] + H3[1] * q[1] + H3[2]) / w, (H3[3] * q[0] + H3[4] * q[1] + H3[5]) / w];
      });
      var dx = Q[1][0] - Q[0][0], dy = Q[1][1] - Q[0][1], len = Math.hypot(dx, dy) || 1e-9;
      var e = l.k === 'h' ? dy / len : dx / len;          // 어긋난 각의 sin
      return { e: e, w: Math.hypot(P[1][0] - P[0][0], P[1][1] - P[0][1]) };
    });
  }

  /** 돌려주는 값: { rotate, vertical, horizontal, off: [선마다 남은 어긋남(°)], ok } */
  function solveGuides(lines, W, H, start) {
    lines = (lines || []).filter(function (l) { return l && Math.hypot(l.x2 - l.x1, l.y2 - l.y1) > 4; });
    var res = { rotate: 0, vertical: 0, horizontal: 0, off: [], ok: false };
    if (!lines.length) return res;
    var L = St.LIMIT, nV = lines.filter(function (l) { return l.k !== 'h'; }).length, nH = lines.length - nV;
    function obj(v) {
      var a = { rotate: v[0], vertical: nV >= 2 ? v[1] : 0, horizontal: nH >= 2 ? v[2] : 0 };
      var errs = lineErrors(fwd(a), lines, W, H), s = 0;
      for (var i = 0; i < errs.length; i++) s += errs[i].w * errs[i].e * errs[i].e;
      // 선이 모자랄 때 원근이 제멋대로 커지지 않게 아주 작은 벌점
      return s + 1e-5 * ((v[1] / 100) * (v[1] / 100) + (v[2] / 100) * (v[2] / 100));
    }
    var lo = [-L.rotate, -L.vertical, -L.horizontal], hi = [L.rotate, L.vertical, L.horizontal];
    var best = null, starts = [[0, 0, 0]];
    if (start) starts.push([start.rotate || 0, start.vertical || 0, start.horizontal || 0]);
    starts.forEach(function (v0) {
      var v = v0.slice(), f = obj(v), step = [3, 30, 30], minStep = [0.004, 0.04, 0.04];
      for (var it = 0; it < 600; it++) {
        var improved = false;
        for (var i = 0; i < 3; i++) {
          if ((i === 1 && nV < 2) || (i === 2 && nH < 2)) continue;
          for (var sgn = -1; sgn <= 1; sgn += 2) {
            var t = v.slice(); t[i] = clamp(t[i] + sgn * step[i], lo[i], hi[i]);
            var ft = obj(t);
            if (ft < f - 1e-14) { v = t; f = ft; improved = true; }
          }
        }
        if (!improved) {
          var done = true;
          for (var j = 0; j < 3; j++) { step[j] *= 0.5; if (step[j] > minStep[j]) done = false; }
          if (done) break;
        }
      }
      if (!best || f < best.f) best = { v: v, f: f };
    });
    var n = St.normalize({ rotate: best.v[0], vertical: nV >= 2 ? best.v[1] : 0, horizontal: nH >= 2 ? best.v[2] : 0 });
    var after = lineErrors(fwd(n), lines, W, H);
    res.rotate = n.rotate; res.vertical = n.vertical; res.horizontal = n.horizontal;
    res.off = after.map(function (r) { return Math.round(Math.asin(clamp(r.e, -1, 1)) * 180 / Math.PI * 100) / 100; });
    res.ok = true;
    return res;
  }

  // ─────────────────────────────────────────────
  // 한 장 전체 처리 (서버가 원본 크기로 저장할 때 쓴다. 화면 미리보기는 같은 순서로 단계마다 부른다)
  //   params: { rotate, vertical, horizontal, tone, mosaic }
  // ─────────────────────────────────────────────
  function isIdentity(p) {
    p = p || {};
    return St.isIdentity(p) && !hasTone(p.tone) && !hasMosaic(p.mosaic);
  }
  function process(src, W, H, ch, p) {
    p = p || {};
    var geo = St.normalize(p), data = src;
    if (hasMosaic(p.mosaic)) { data = new Uint8Array(src.length); data.set(src); mosaicApply(data, W, H, ch, p.mosaic); }
    var out = new Uint8Array(W * H * ch);
    St.render(data, W, H, ch, geo, out);
    if (hasTone(p.tone)) toneApply(out, W, H, ch, normTone(p.tone));
    return out;
  }

  return {
    TONE_KEYS: TONE_KEYS, normTone: normTone, hasTone: hasTone, toneApply: toneApply, autoTone: autoTone,
    normMosaic: normMosaic, hasMosaic: hasMosaic, mosaicMask: mosaicMask, mosaicApply: mosaicApply,
    mapToSource: mapToSource, solveGuides: solveGuides, isIdentity: isIdentity, process: process,
  };
});
