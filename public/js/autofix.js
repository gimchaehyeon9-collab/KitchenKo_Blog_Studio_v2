/* 자동 보정 — [자동 보정] 버튼을 누르면 올라온 사진을 한 장씩 살펴보고, "문제가 있는 사진만" 색톤·밝기를 바로잡아요 (키친앤코·레몬하우스 공통).
   고치는 경우:  너무 어두움(중간 밝기가 낮거나 어두운 곳이 많음) · 너무 밝음(하얗게 날아간 사진) · 뿌옇게 밋밋함(밝은 곳과 어두운 곳의 차이가 아주 적음) · 색 쏠림(흰 벽이 누렇거나 푸르거나 초록빛)
   그 밖의 알맞은 사진은 그대로 둬요 (밝고 하얀 주방 사진은 일부러 밝은 것이라 건드리지 않아요). 이미 [색·밝기 조절]을 직접 만진 사진도 건드리지 않아요.
   값은 라이트룸 방식의 막대(노출·밝은 영역·어두운 영역·색온도…)로 들어가서 카드의 [색·밝기 조절]에서 사진마다 다시 고칠 수 있고, [자동 보정 되돌리기]로 한 번에 취소할 수 있어요.
   내보낼 때는 원본 사진에서 이 값으로 한 번에 만들어요 (export.js). */
(function (root) {
'use strict';
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const TH = { dark: 0.42, bright: 0.88, blown: 0.20, deadShadow: 0.45, flat: 0.38, tp: 8, tn: 6 };       // 판단 기준 — 밝은 흰색 주방 사진이 어두워지지 않게 '너무 밝음'은 하얗게 날아간 사진만, '밋밋함'은 아주 뿌연 사진만
const LABEL = { dark: '어두움', bright: '너무 밝음', flat: '밋밋함', cast: '색 쏠림' };
const KEYNAME = { ex: '노출', ct: '대비', hl: '밝은 영역', sh: '어두운 영역', wh: '흰색', bk: '검은색', tp: '색온도', tn: '색조' };
const TONE_PART = ['ex', 'ct', 'hl', 'sh', 'wh', 'bk'], WB_PART = ['tp', 'tn'];

/* 사진 픽셀(RGBA, 작게 줄인 것) → { kinds, adj, stats } — kinds 가 비어 있으면 알맞은 사진 */
function look(KK, d, w, h) {
  const hist = new Float32Array(256), step = Math.max(1, Math.floor(Math.sqrt(w * h / 60000)));
  let cnt = 0;
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) { const p = (y * w + x) * 4; hist[Math.min(255, (0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2]) | 0)]++; cnt++; }
  const pct = q => { let a = 0; const t = q * cnt; for (let i = 0; i < 256; i++) { a += hist[i]; if (a >= t) return i / 255; } return 1; };
  const p1 = pct(0.01), p50 = pct(0.5), p99 = pct(0.99);
  let low = 0; for (let i = 0; i < 51; i++) low += hist[i]; low /= cnt;                 // 밝기 0.2 미만 비율
  let hi = 0; for (let i = 243; i < 256; i++) hi += hist[i]; hi /= cnt;                  // 밝기 0.95 넘는 비율
  const kinds = [];
  if (p50 < TH.dark || (low > TH.deadShadow && p50 < 0.5)) kinds.push('dark');
  else if (p50 > TH.bright && hi > TH.blown) kinds.push('bright');
  else if (p99 - p1 < TH.flat) kinds.push('flat');
  const wb = KK.autoToneAdj(d, w, h, { tone: false, wb: true });
  if (Math.abs(wb.tp || 0) >= TH.tp || Math.abs(wb.tn || 0) >= TH.tn) kinds.push('cast');
  const adj = {};
  if (kinds.some(k => k !== 'cast')) { const t = KK.autoToneAdj(d, w, h, { tone: true, wb: false }); for (const k of TONE_PART) if (Math.abs(t[k] || 0) >= 3) adj[k] = t[k]; }
  if (kinds.includes('cast')) for (const k of WB_PART) if (Math.abs(wb[k] || 0) >= 3) adj[k] = wb[k];
  if (!Object.keys(adj).length) return { kinds: [], adj, stats: { p1, p50, p99, low, hi } };
  return { kinds, adj, stats: { p1, p50, p99, low, hi } };
}
const api = { look, TH, LABEL };
if (root && root.KK) {
  const KK = root.KK, $ = id => root.document.getElementById(id);
  KK._autofix = api;
  let undo = null;                                           // { 사진 id → 보정 전 adj(없었으면 null) }
  const loadImage = src => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(Error('사진을 열 수 없어요.')); im.src = src; });
  async function pixels(p, max) {
    const im = await loadImage(p.data), sc = Math.min(1, max / Math.max(p.w, p.h)), w = Math.max(8, Math.round(p.w * sc)), h = Math.max(8, Math.round(p.h * sc));
    const c = root.document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(im, 0, 0, w, h);
    return { d: ctx.getImageData(0, 0, w, h).data, w, h };
  }
  const yieldUi = () => new Promise(r => setTimeout(r));
  const status = (msg, kind) => { const el = $('autoFixStatus'); if (!el) return; el.hidden = !msg; el.textContent = msg || ''; el.className = 'status ' + (kind || ''); };
  const fmt = v => (v > 0 ? '+' : '') + v;

  KK.autoFixAll = async () => {
    const ids = [...new Set(KK.state.cards.flatMap(c => c.photoIds))], btn = $('autoFixAll');
    if (!ids.length) return KK.toast('사진을 먼저 올려 주세요.', 'error');
    btn.disabled = true; const label0 = btn.textContent;
    const snap = {}, lines = []; const cnt = { dark: 0, bright: 0, flat: 0, cast: 0 }; let fixed = 0, fine = 0, manual = 0, failed = 0;
    try {
      for (let i = 0; i < ids.length; i++) {
        btn.textContent = '사진 살펴보는 중 ' + (i + 1) + '/' + ids.length;
        const p = KK.photos.get(ids[i]); if (!p) continue;
        if (KK.hasTone(p.adj)) { manual++; continue; }
        try {
          const { d, w, h } = await pixels(p, 480), r = look(KK, d, w, h);
          if (!r.kinds.length) { fine++; continue; }
          snap[p.id] = p.adj ? { ...p.adj } : null;
          p.adj = Object.assign(p.adj || {}, r.adj); fixed++;
          for (const k of r.kinds) cnt[k]++;
          lines.push((i + 1) + '번 ' + (p.name || '') + ' — ' + r.kinds.map(k => LABEL[k]).join('·') + ' → ' + Object.keys(r.adj).map(k => KEYNAME[k] + ' ' + fmt(r.adj[k])).join(' · '));
        } catch (_) { failed++; }
        await yieldUi();
      }
      undo = fixed ? snap : null;
      if ($('autoFixUndo')) $('autoFixUndo').hidden = !fixed;
      if (fixed) { KK.changed('structure'); await KK.renderCover(); KK.renderPreview(); }
      const parts = Object.keys(cnt).filter(k => cnt[k]).map(k => LABEL[k] + ' ' + cnt[k] + '장');
      const head = fixed ? '자동 보정 — ' + fixed + '장 보정 (' + parts.join(' · ') + ')' : '자동 보정 — 고칠 사진이 없어요';
      const tail = [fine ? fine + '장은 이미 알맞아 그대로' : '', manual ? manual + '장은 직접 조절한 값이 있어 그대로' : '', failed ? failed + '장은 읽지 못해 건너뜀' : ''].filter(Boolean).join(' · ');
      status(head + (tail ? '\n' + tail : '') + (lines.length ? '\n' + lines.slice(0, 14).join('\n') + (lines.length > 14 ? '\n… 외 ' + (lines.length - 14) + '장' : '') : '') + (fixed ? '\n카드의 [색·밝기 조절]에서 사진마다 고칠 수 있고, [자동 보정 되돌리기]로 한 번에 취소할 수 있어요.' : ''), fixed ? 'ok' : '');
      KK.toast(head + (tail ? ' · ' + tail : '') + '.', fixed ? 'ok' : undefined);
      return { fixed, fine, manual, failed, cnt, lines };
    } finally { btn.disabled = false; btn.textContent = label0; }
  };
  KK.autoFixUndo = async () => {
    if (!undo) return KK.toast('되돌릴 자동 보정이 없어요.', 'error');
    let n = 0;
    for (const [id, before] of Object.entries(undo)) { const p = KK.photos.get(id); if (!p) continue; if (before) p.adj = before; else delete p.adj; n++; }
    undo = null; $('autoFixUndo').hidden = true; status('');
    KK.changed('structure'); await KK.renderCover(); KK.renderPreview();
    KK.toast('자동 보정을 취소했어요 (' + n + '장).', 'ok');
  };
  if ($('autoFixAll')) {
    $('autoFixAll').addEventListener('click', () => KK.autoFixAll().catch(e => KK.toast('자동 보정 중 문제가 생겼어요: ' + e.message, 'error')));
    $('autoFixUndo').addEventListener('click', () => KK.autoFixUndo());
  }
}
})(typeof window !== 'undefined' ? window : null);
