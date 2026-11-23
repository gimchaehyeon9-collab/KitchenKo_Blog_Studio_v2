/* 선으로 맞추기 (도우미) — 원본 사진 위에 "이 선은 수평이어야 해요 / 수직이어야 해요 / 서로 평행해야 해요" 하는 선을 그으면
   기울기·세로 원근·가로 원근을 계산해서 오른쪽에 맞춘 모습을 바로 보여 줘요. [적용]을 누르면 그 사진에 들어가요.
   도구 4개: 수평선(1) · 수직선(1) · 세로 평행선(2) · 가로 평행선(2) — 여러 도구를 함께 써도 되고, 쓰지 않은 항목은 지금 값 그대로예요. */
(() => {
'use strict';
const KK = window.KK;
const TOOLS = [
  { k: 'h', name: '수평선', need: 1, color: '#e0457b', hint: '수평이어야 하는 선(바닥과 벽이 만나는 선, 선반·창틀의 가로선)을 따라 점 두 개를 찍듯이 끌어 주세요.' },
  { k: 'v', name: '수직선', need: 1, color: '#1f9d55', hint: '수직이어야 하는 선(문틀, 벽 모서리, 창틀의 세로선)을 따라 끌어 주세요.' },
  { k: 'pv', name: '세로 원근', need: 2, color: '#2f7de1', hint: '서로 나란해야 하는 세로선 두 개(예: 왼쪽·오른쪽 벽 모서리)를 끌어 주세요. 위아래로 모여 보이는 사진이 곧게 펴져요. 멀리 떨어진 두 선일수록 정확해요.' },
  { k: 'ph', name: '가로 원근', need: 2, color: '#e08a1e', hint: '서로 나란해야 하는 가로선 두 개(예: 천장선과 바닥선)를 끌어 주세요. 좌우로 모여 보이는 사진이 곧게 펴져요.' },
];
let ui = null;
const mk = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

function build() {
  const ov = mk('div', 'lh-overlay'); ov.hidden = true;
  ov.innerHTML = `<div class="lh-box" role="dialog" aria-modal="true" aria-label="선으로 맞추기">
    <div class="lh-head"><b>선으로 맞추기</b><span class="muted">사진 위에 선을 그으면 기울기·원근을 알아서 계산해요</span><button type="button" class="tiny" data-lh="close">닫기</button></div>
    <div class="lh-tabs"></div>
    <p class="lh-hint"></p>
    <div class="lh-panes">
      <div class="lh-pane"><div class="lh-cap">① 원본 위에 선 긋기 <small>(끝점을 끌면 옮길 수 있어요)</small></div><div class="lh-stage lh-src"><img alt="" draggable="false"><svg></svg></div></div>
      <div class="lh-pane"><div class="lh-cap">② 맞춘 모습 <small>(격자에 맞는지 확인하세요)</small></div><div class="lh-stage lh-prev"><canvas></canvas></div></div>
    </div>
    <div class="lh-foot"><span class="lh-res"></span><span class="lh-btns"><button type="button" class="tiny" data-lh="undo">마지막 선 지우기</button><button type="button" class="tiny" data-lh="clear">선 모두 지우기</button><button type="button" class="btn primary" data-lh="apply" disabled>적용</button></span></div>
  </div>`;
  document.body.appendChild(ov);
  const q = s => ov.querySelector(s);
  ui = { ov, tabs: q('.lh-tabs'), hint: q('.lh-hint'), src: q('.lh-src'), img: q('.lh-src img'), svg: q('.lh-src svg'), prev: q('.lh-prev'), cv: q('.lh-prev canvas'), res: q('.lh-res'), apply: q('[data-lh=apply]') };
  ui.tabs.innerHTML = TOOLS.map(t => `<button type="button" class="lh-tab" data-tool="${t.k}" style="--c:${t.color}"><i></i>${t.name}<small></small></button>`).join('');
  ov.addEventListener('click', e => {
    const tb = e.target.closest('[data-tool]'); if (tb) { st.tool = tb.dataset.tool; refreshTabs(); return; }
    const a = e.target.closest('[data-lh]')?.dataset.lh;
    if (a === 'close') close();
    if (a === 'clear') { st.lines = { h: [], v: [], pv: [], ph: [] }; recalc(); }
    if (a === 'undo') { const l = st.lines[st.tool]; if (l.length) l.pop(); else for (const t of TOOLS) if (st.lines[t.k].length) { st.lines[t.k].pop(); break; } recalc(); }
    if (a === 'apply' && st.res) { const r = st.res, cb = st.cb; close(); cb && cb(r); }
  });
  document.addEventListener('keydown', e => { if (!ui.ov.hidden && e.key === 'Escape') close(); });
  window.addEventListener('resize', () => { if (!ui.ov.hidden) { fit(); drawLines(); } });
  bindDraw();
}

const st = { tool: 'h', lines: { h: [], v: [], pv: [], ph: [] }, p: null, W: 1, H: 1, cb: null, res: null, small: null, drag: null };
const close = () => { ui.ov.hidden = true; st.cb = null; st.small = null; };

function fit() {   // 사진 비율대로 칸 크기를 맞춰요
  const pane = ui.src.parentElement, pw = Math.max(160, pane.clientWidth - 2), maxH = Math.max(200, window.innerHeight * 0.5);
  const w = Math.min(pw, maxH * st.W / st.H), h = w * st.H / st.W;
  for (const el of [ui.src, ui.prev]) { el.style.width = w + 'px'; el.style.height = h + 'px'; }
  st.cw = w; st.ch = h;
  ui.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
}
const toScr = pt => [pt[0] * st.cw / st.W, pt[1] * st.ch / st.H];
function drawLines() {
  let h = '';
  for (const t of TOOLS) {
    const act = t.k === st.tool;
    for (const l of st.lines[t.k]) {
      const [a, b] = [toScr(l[0]), toScr(l[1])];
      h += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${t.color}" stroke-width="${act ? 2.5 : 1.5}" opacity="${act ? 1 : .55}" stroke-linecap="round"/>`;
      if (act) h += [a, b].map(pt => `<circle cx="${pt[0]}" cy="${pt[1]}" r="7" fill="#fff" stroke="${t.color}" stroke-width="2.5"/>`).join('');
    }
  }
  ui.svg.innerHTML = h;
}
function refreshTabs() {
  for (const b of ui.tabs.children) {
    const t = TOOLS.find(x => x.k === b.dataset.tool), n = Math.min(st.lines[t.k].length, t.need);
    b.classList.toggle('on', t.k === st.tool); b.querySelector('small').textContent = ` ${n}/${t.need}`; b.classList.toggle('done', n >= t.need);
  }
  ui.hint.textContent = TOOLS.find(t => t.k === st.tool).hint;
  drawLines();
}
/* 선 → 값 → 맞춘 모습 */
function recalc() {
  const g = {}; for (const t of TOOLS) g[t.k] = st.lines[t.k].length >= t.need ? st.lines[t.k] : [];
  const any = TOOLS.some(t => g[t.k].length >= t.need);
  const cur = st.p.adj || {};
  let res = null, msg = '';
  if (any) {
    try {
      res = KK.geoFromGuides(g, st.W, st.H, { vp: cur.vp || 0, hp: cur.hp || 0 });
      // 선을 쓰지 않은 항목은 지금 값 그대로
      const names = { rot: '기울기', vp: '세로 원근', hp: '가로 원근' };
      msg = ['rot', 'vp', 'hp'].filter(k => res[k] != null).map(k => names[k] + ' ' + (k === 'rot' ? (res[k] > 0 ? '+' : '') + res[k].toFixed(1) + '°' : (res[k] > 0 ? '+' : '') + res[k])).join(' · ');
      if (Math.max(res.residualV || 0, res.residualH || 0) > 2) msg += '  ⚠ 선이 서로 많이 달라요. 선 위치를 다시 확인해 주세요';
    } catch (e) { msg = e.message; }
  } else msg = '선을 그으면 여기에 계산 결과가 나와요.';
  st.res = res; ui.res.textContent = msg; ui.apply.disabled = !res;
  refreshTabs(); drawPreview();
}
function drawPreview() {
  if (!st.small) return;
  const { d, w, h } = st.small, cur = st.p.adj || {}, r = st.res || {};
  const a = { rot: r.rot != null ? r.rot : (cur.rot || 0), vp: r.vp != null ? r.vp : (cur.vp || 0), hp: r.hp != null ? r.hp : (cur.hp || 0) };
  // 선을 하나도 안 그었을 때는 지금 보정된 모습을 그대로 보여 줘요
  const out = KK.hasGeo(a) ? KK.geoWarp(d, w, h, a) : d, ctx = ui.cv.getContext('2d');
  ui.cv.width = w; ui.cv.height = h; ctx.putImageData(new ImageData(new Uint8ClampedArray(out), w, h), 0, 0);
}
/* 그리기: 빈 곳을 끌면 새 선, 끝점(동그라미)을 끌면 옮기기 */
function bindDraw() {
  const el = ui.src, pos = e => { const r = ui.svg.getBoundingClientRect(); return [Math.max(0, Math.min(st.cw, e.clientX - r.left)), Math.max(0, Math.min(st.ch, e.clientY - r.top))]; };
  const toPhoto = s => [s[0] * st.W / st.cw, s[1] * st.H / st.ch];
  el.addEventListener('pointerdown', e => {
    if (e.button != null && e.button > 0) return;
    const s = pos(e), t = TOOLS.find(x => x.k === st.tool), arr = st.lines[t.k];
    for (let i = 0; i < arr.length; i++) for (let j = 0; j < 2; j++) { const q = toScr(arr[i][j]); if (Math.hypot(q[0] - s[0], q[1] - s[1]) <= 14) { st.drag = { arr, line: arr[i], j, move: true, committed: true }; el.setPointerCapture(e.pointerId); e.preventDefault(); return; } }
    const p0 = toPhoto(s);
    st.drag = { arr, line: [p0, p0.slice()], j: 1, move: false, committed: false, start: s, need: t.need };   // 조금 끌어야 선으로 쳐요 (클릭만으로는 기존 선이 밀려나지 않게)
    el.setPointerCapture(e.pointerId); e.preventDefault();
  });
  el.addEventListener('pointermove', e => {
    const d = st.drag; if (!d) return; const s = pos(e); d.line[d.j] = toPhoto(s);
    if (!d.committed && Math.hypot(s[0] - d.start[0], s[1] - d.start[1]) > 10) { d.arr.push(d.line); while (d.arr.length > d.need) d.arr.shift(); d.committed = true; }
    if (!d.committed) return;
    drawLines(); clearTimeout(st.tm); st.tm = setTimeout(() => { if (st.drag) recalcLive(); }, 60);
  });
  const end = () => {
    const d = st.drag; if (!d) return; st.drag = null; clearTimeout(st.tm);
    if (d.committed && !d.move) { const a = toScr(d.line[0]), b = toScr(d.line[1]); if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 12) { const i = d.arr.indexOf(d.line); if (i >= 0) d.arr.splice(i, 1); } }
    recalc();
  };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
}
function recalcLive() {   // 끄는 중에는 길이가 충분한 선만으로 가볍게 다시 계산
  const t = TOOLS.find(x => x.k === st.tool), arr = st.lines[t.k]; if (!arr.length) return;
  const l = arr[arr.length - 1], a = toScr(l[0]), b = toScr(l[1]); if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 12) return;
  recalc();
}

/* p: 사진({data,w,h,adj}), cb(res): [적용]을 누르면 { rot?, vp?, hp? } 로 불러요 (선을 쓰지 않은 항목은 없음) */
KK.openLevelHelper = (p, cb) => {
  if (!ui) build();
  st.p = p; st.W = p.w; st.H = p.h; st.cb = cb; st.res = null; st.lines = { h: [], v: [], pv: [], ph: [] }; st.tool = 'h';
  ui.img.src = p.data; ui.ov.hidden = false; fit();
  // 미리보기용 작은 사진 (긴 변 560px)
  const im = new Image(); im.onload = () => {
    const sc = Math.min(1, 560 / Math.max(im.naturalWidth, im.naturalHeight)), w = Math.max(8, Math.round(im.naturalWidth * sc)), h = Math.max(8, Math.round(im.naturalHeight * sc));
    const c = document.createElement('canvas'); c.width = w; c.height = h; const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(im, 0, 0, w, h);
    st.small = { d: ctx.getImageData(0, 0, w, h).data, w, h }; fit(); drawPreview();
  }; im.src = p.data;
  recalc();
};
})();
