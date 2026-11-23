/* 단계별 화면 (2.10.33)
 * 한 화면에 모든 칸이 붙어 있던 것을 "지금 할 일"만 보이게 단계로 나눠요.
 * - 칸(panel 등)에 data-step="2 3" 처럼 달아 두면, 그 단계에서만 보여요. (숨기기만 하고 내용·값은 그대로예요)
 * - 단계는 막지 않아요. 위쪽 단계 줄을 눌러 어느 단계로든 바로 갈 수 있어요.
 * - [한 화면에 모두 보기]를 누르면 예전처럼 한 번에 다 펼쳐 보여요. (이 선택은 기억해요)
 * 주소 끝에 ?wz=0 을 붙이면 그 한 번만 예전 방식으로 열어요 (시험용).
 */
(() => {
'use strict';
const KK = window.KK;
const $ = id => document.getElementById(id);
const MODE_KEY = 'kk-wizard';
const urlMode = (() => { try { const v = new URLSearchParams(location.search).get('wz'); return v === '0' ? false : v === '1' ? true : null; } catch (_) { return null; } })();
const readMode = () => { if (urlMode !== null) return urlMode; try { return localStorage.getItem(MODE_KEY) !== '0'; } catch (_) { return true; } };
let mode = readMode();
const hubs = {};
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const stored = k => { try { return Number(sessionStorage.getItem('kk-step-' + k)) || 0; } catch (_) { return 0; } };
const store = (k, n) => { try { sessionStorage.setItem('kk-step-' + k, String(n)); } catch (_) {} };

function make(key, cfg) {
  const root = document.querySelector(cfg.root); if (!root) return null;
  const h = { key, cfg, root, bar: $(cfg.bar), nav: $(cfg.nav), desc: $(cfg.desc), n: 1 };
  hubs[key] = h;
  const steps = cfg.steps;
  h.n = Math.min(steps.length, Math.max(1, stored(key) || 1));
  h.bar.innerHTML = '<div class="wz-steps" role="tablist" aria-label="단계">' + steps.map((s, i) =>
    `<button type="button" class="wz-st" role="tab" data-wz="${i + 1}"><i>${i + 1}</i><span class="wz-lb">${esc(s.label)}</span><em class="wz-bd"></em></button>`).join('') + '</div>'
    + '<button type="button" class="link wz-mode"></button>';
  h.nav.innerHTML = '<button type="button" class="btn ghost wz-prev"></button><span class="wz-pos"></span><button type="button" class="btn primary wz-next"></button>';
  const onMode = e => { if (e.target.closest('.wz-mode')) setMode(!mode); };
  h.bar.addEventListener('click', e => {
    const b = e.target.closest('[data-wz]'); if (b) { go(key, Number(b.dataset.wz), { top: true }); return; }
    onMode(e);
  });
  if (h.desc) h.desc.addEventListener('click', onMode);
  h.nav.addEventListener('click', e => {
    if (e.target.closest('.wz-prev')) go(key, h.n - 1, { top: true });
    else if (e.target.closest('.wz-next')) go(key, h.n + 1, { top: true });
  });
  apply(h);
  return h;
}

function apply(h) {
  const n = h.cfg.steps.length;
  document.body.classList.toggle('wz-on', mode);
  h.root.classList.toggle('wz', mode);
  for (let i = 1; i <= n; i++) h.root.classList.toggle('s' + i, i === h.n);
  const st = h.cfg.steps[h.n - 1];
  [h.bar, h.desc].forEach(el => { const m = el && el.querySelector('.wz-mode'); if (m) m.textContent = mode ? '한 화면에 모두 보기' : '단계별로 보기'; });
  h.bar.querySelectorAll('.wz-st').forEach(b => {
    const i = Number(b.dataset.wz), on = i === h.n;
    b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  if (h.desc) h.desc.querySelector('.wz-desc-t').textContent = st.desc || '';
  const prev = h.nav.querySelector('.wz-prev'), next = h.nav.querySelector('.wz-next');
  prev.hidden = h.n <= 1; prev.textContent = '← ' + (h.n > 1 ? h.cfg.steps[h.n - 2].label : '');
  next.hidden = h.n >= n; next.textContent = (h.n < n ? '다음: ' + h.cfg.steps[h.n].label : '') + ' →';
  h.nav.querySelector('.wz-pos').textContent = h.n + ' / ' + n + ' · ' + st.label;
  refresh(h.key);
}

function go(key, n, opt) {
  const h = hubs[key]; if (!h) return;
  const max = h.cfg.steps.length;
  n = Math.min(max, Math.max(1, Math.round(Number(n)) || 1));
  const changed = n !== h.n;
  h.n = n; store(key, n); apply(h);
  if (changed && opt && opt.top && mode) { try { window.scrollTo({ top: 0, behavior: 'auto' }); } catch (_) { window.scrollTo(0, 0); } }
  if (changed && h.cfg.onStep) { try { h.cfg.onStep(n); } catch (_) {} }
}

// 단계 줄의 ✓ · 작은 안내(예: 사진 8장)를 지금 상태에 맞게 다시 그려요
function refresh(key) {
  for (const h of (key ? [hubs[key]] : Object.values(hubs))) {
    if (!h) continue;
    h.cfg.steps.forEach((s, i) => {
      const b = h.bar.querySelector('[data-wz="' + (i + 1) + '"]'); if (!b) return;
      let r = {}; try { r = (s.badge && s.badge()) || {}; } catch (_) {}
      b.classList.toggle('done', !!r.done);
      b.querySelector('i').textContent = r.done ? '✓' : String(i + 1);
      b.querySelector('.wz-bd').textContent = r.text || '';
      b.title = s.label + (r.text ? ' · ' + r.text : '') + (s.desc ? '\n' + s.desc : '');
    });
  }
}

function setMode(on) {
  mode = !!on;
  try { localStorage.setItem(MODE_KEY, mode ? '1' : '0'); } catch (_) {}
  Object.values(hubs).forEach(apply);
  syncFolds();
}
// 새로 접어 둔 칸(wz-fold)은 한 화면 모드에서는 예전처럼 펼쳐 두어요
function syncFolds() { document.querySelectorAll('details.wz-fold, details[data-wzfold]').forEach(d => { d.open = !mode || d.hasAttribute('data-open'); }); }

KK.stepper = { make, go, refresh, setMode, mode: () => mode, cur: key => (hubs[key] || {}).n || 0, syncFolds };
KK.goStep = (n, key) => go(key || 'blog', n, { top: false });

/* ── 블로그 탭의 단계 ── */
const nz = v => String(v == null ? '' : v).trim();
const BLOG = [
  { label: '현장·키워드', desc: '아파트 이름과 키워드를 정해요.',
    badge: () => { const s = KK.state || {}, a = nz(s.apt); return { text: a.length > 6 ? a.slice(0, 6) + '…' : a, done: !!a }; } },
  { label: '사진 정리', desc: '사진을 넣고 → 순서를 맞추고 → 콜라주로 묶어요. 위쪽 작은 미리보기에서 끌어서 바꿀 수 있어요.',
    badge: () => { const n = KK.photos ? KK.photos.size : 0, c = ((KK.state || {}).cards || []).length; return { text: n ? n + '장' + (c && c !== n ? ' → ' + c + '칸' : '') : '', done: c > 0 }; } },
  { label: '글 쓰기', desc: 'Claude로 한 번에 쓰고, 문단마다 고쳐요. (사진 모양은 ② 사진 정리에서 바꿔요)',
    badge: () => { const cs = ((KK.state || {}).cards || []), f = cs.filter(c => nz(c.text)).length; return { text: cs.length ? f + '/' + cs.length : '', done: cs.length > 0 && f === cs.length }; } },
  { label: '제목·대표사진', desc: '제목을 고르고, 대표사진(1:1)과 동영상을 정해요. 미리보기도 여기서 볼 수 있어요.',
    badge: () => { const s = KK.state || {}; const has = !!(s.cover && s.cover.photoId); return { text: has ? '대표 ✓' : '', done: has }; } },
  { label: '점검·보내기', desc: '원고 점검을 보고, 네이버에 입력해서 임시저장해요. (발행은 직접 해요)',
    badge: () => { const p = $('checkPill'); if (!p) return {}; const t = nz(p.textContent); return { text: /점검해요/.test(t) ? '' : t, done: p.classList.contains('ok') }; } },
];

/* ── 레몬 현장 탭의 단계 ── */
const LEMON = [
  { label: '내 블로그', desc: '사진을 옮겨 둘 내 블로그와 인텍 번호를 골라요. 연결이 안 돼 있으면 [연결 설정]이 저절로 열려요.',
    badge: () => { const L = KK.lemonInfo ? KK.lemonInfo() : {}; const sel = $('lmBlog'); const o = sel && sel.selectedOptions && sel.selectedOptions[0]; return { text: L.myBlog && o ? o.textContent.replace(/\s+/g, ' ').trim() : '', done: !!L.myBlog }; } },
  { label: '현장 고르기', desc: '쓸 아파트와 평형이 비슷한 현장이 위에 먼저 나와요. 현장 옆 [가져오기]를 누르면 내 폴더로 옮기고 반전·각인한 뒤 블로그 화면에 넣어 줘요.',
    badge: () => { const L = KK.lemonInfo ? KK.lemonInfo() : {}; const c = $('lmCount'); return { text: c && c.textContent !== '-' ? nz(c.textContent) : '', done: !!(L.last && L.last.at >= PAGE_START) }; } },
];
/* ── 인스타 탭의 단계 ── */
const INSTA = [
  { label: '올릴 현장', desc: '아직 안 올린 품목이 있는 현장을 골라요. 이미 직접 올린 글은 아래에서 시트에 기록해요.',
    badge: () => { const g = KK.igInfo ? KK.igInfo() : {}; return { text: g.site ? nz($('pkTitle') && $('pkTitle').textContent) : '', done: !!g.site }; } },
  { label: '사진 고르기', desc: '올릴 사진을 골라요. 눌러서 고른 순서가 게시 순서예요 (최대 10장).',
    badge: () => { const g = KK.igInfo ? KK.igInfo() : {}; const n = (g.picked || []).length; return { text: n ? n + '장' : '', done: n > 0 }; } },
  { label: '사진 맞추기', desc: '사진을 끌어서 보일 부분을 맞춰요. 미리보기에서 화살표로 넘기며 고쳐도 돼요.',
    badge: () => { const g = KK.igInfo ? KK.igInfo() : {}; const n = (g.crops || []).length; return { text: n ? n + '장' : '', done: n > 0 }; } },
  { label: '캡션', desc: 'Claude로 캡션 3안을 만들고 골라요. 직접 고쳐도 돼요.',
    badge: () => { const b = $('igBody'); const has = !!nz(b && b.value); return { text: has ? '작성됨' : '', done: has }; } },
  { label: '예약·발행', desc: '게시 날짜를 정하고 예약 저장하거나 바로 발행해요. 예약 목록도 여기서 봐요.',
    badge: () => { const q = $('igQueueTab'); const n = nz(q && q.textContent); return { text: n ? '예약 ' + n + '건' : '', done: false }; } },
];
const PAGE_START = Date.now();

// 여러 곳이 같이 쓰는 화면(레몬·인스타)은 안의 내용이 바뀔 때마다 알아서 ✓·안내를 다시 맞춰요
function watch(key) {
  const h = hubs[key]; if (!h) return; let t = 0;
  const kick = () => { clearTimeout(t); t = setTimeout(() => refresh(key), 120); };
  const mine = n => { const el = n && (n.nodeType === 1 ? n : n.parentElement); return !!(el && el.closest && el.closest('.wz-bar,.wz-nav,.wz-desc')); };
  if (window.MutationObserver) new MutationObserver(ms => { if (ms.some(m => !mine(m.target))) kick(); })
    .observe(h.root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'hidden'] });
  h.root.addEventListener('input', kick); h.root.addEventListener('change', kick);
}

function init() {
  const top = document.querySelector('header.top');
  const setTop = () => { if (top) document.documentElement.style.setProperty('--top-h', top.offsetHeight + 'px'); };
  setTop(); window.addEventListener('resize', setTop);
  if ($('blogSteps')) make('blog', { root: 'main.layout', bar: 'blogSteps', nav: 'blogNav', desc: 'blogStepsDesc', steps: BLOG });
  if ($('lmSteps')) { make('lemon', { root: '#hubLemon .hub-grid', bar: 'lmSteps', nav: 'lmNav', desc: 'lmStepsDesc', steps: LEMON }); watch('lemon'); }
  if ($('igSteps')) { make('insta', { root: '#hubInsta .hub-grid', bar: 'igSteps', nav: 'igNav', desc: 'igStepsDesc', steps: INSTA }); watch('insta'); }
  syncFolds();
  // 시트 기록이 못 보내졌을 때는 접어 둔 칸을 자동으로 열어서 놓치지 않게 해요
  const fold = $('recFold');
  if (fold && window.MutationObserver) {
    new MutationObserver(() => { if (['ksRetry', 'lrRetry'].some(id => $(id) && !$(id).hidden)) fold.open = true; })
      .observe(fold, { subtree: true, attributes: true, attributeFilter: ['hidden'] });
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
