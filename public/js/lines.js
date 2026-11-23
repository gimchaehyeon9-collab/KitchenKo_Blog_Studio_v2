/* 줄 정리 — 네이버 블로그에서 글이 줄 끝에서 저절로 꺾여 "완성 / 되었으며"처럼 말 중간이 갈라지는 것을 막아요.
   네이버는 글이 한 줄 폭을 넘으면 글자 단위로 아무 데서나 줄을 꺾어요. 그래서 한 줄이 폭 안에 들어오도록 미리 나눠 둬요:
     ① 문장마다 줄을 바꿔요 (끄면: 줄이 폭을 넘을 때만 문장 끝에서 나눠요)
     ② 한 문장 자체가 너무 길면 쉼표 → 이어 주는 말(…하며 · …해서) → 띄어쓰기 순서로 알맞은 곳에서 나눠요
   한 줄 최대 글자 수(기본 50)는 화면에서 바꿀 수 있어요. 이미 정리된 글에 다시 해도 똑같이 나와요.
   (2.10.27) 줄바꿈 방식을 고를 수 있어요 — '없이 이어 쓰기'(키친앤코 기본): 한 문단의 줄바꿈을 모두 없애 한 덩어리로 · '문장마다 줄바꿈'(레몬하우스 기본): 위 ①② */
(function (root) {
'use strict';

const DEF_MAX = 50, MIN_MAX = 20, MAX_MAX = 120;
const SENT_END = /(?<=[.!?…~]["'”’)\]]*)\s+/u;                        // 문장 끝 + 공백 (3.5평 같은 숫자 소수점은 공백이 없어 안 나뉨)
const CONNECT = /(?:이며|으며|이고|하고|하며|해서|하여|라서|이라|인데|는데|지만|니까|다가|더니|으나|면서|으면|이면|려고|도록|거나|든지|고요|한데)$/u;   // 이어 주는 말(문장이 이어지는 자리) — 조사(을·로·에서…)에서는 나누지 않아요
const clampMax = v => { v = Math.round(Number(v)); return Number.isFinite(v) ? Math.min(MAX_MAX, Math.max(MIN_MAX, v)) : DEF_MAX; };

/* 한 문장이 max 를 넘으면 알맞은 곳에서 나눠 줄 목록으로 */
function breakLong(s, max) {
  s = s.trim();
  if (s.length <= max) return [s];
  const cand = { comma: [], connect: [], space: [] };
  for (let i = 1; i < s.length; i++) {                                  // i = 앞 조각의 길이 (앞 조각은 s[0..i), 다음 글자가 공백이어야 거기서 끊음)
    if (s[i] !== ' ') continue;
    const left = s.slice(0, i).trimEnd();
    if (!left) continue;
    if (/[,，、]$/.test(left)) cand.comma.push(i);
    else if (CONNECT.test(left)) cand.connect.push(i);
    else cand.space.push(i);
  }
  const mid = s.length / 2, minLeft = Math.max(6, Math.floor(max * 0.3)), minRight = 6;
  const okBoth = i => i <= max && s.length - i - 1 <= max && i >= minLeft && s.length - i - 1 >= minRight;
  const okLeft = i => i <= max && i >= minLeft && s.length - i - 1 >= minRight;
  let cut = -1;
  for (const tier of ['comma', 'connect', 'space']) {                   // 쉼표가 가장 자연스러워요
    const list = cand[tier];
    const both = list.filter(okBoth);
    if (both.length) { cut = both.reduce((a, b) => Math.abs(b - mid) < Math.abs(a - mid) ? b : a); break; }
    const left = list.filter(okLeft);
    if (left.length && s.length > max * 1.5) { cut = Math.max(...left); break; }
    if (left.length && tier !== 'space') { cut = Math.max(...left); break; }
  }
  if (cut < 0) {                                                        // 마땅한 곳이 없으면 max 앞쪽에서 가장 가까운 띄어쓰기, 그것도 없으면 max 뒤쪽 첫 띄어쓰기
    const all = [...cand.comma, ...cand.connect, ...cand.space].sort((a, b) => a - b);
    cut = all.filter(i => i <= max).pop() ?? all.find(i => i > max) ?? -1;
    if (cut < 0) return [s];                                            // 띄어쓰기가 하나도 없으면 그대로
  }
  return [s.slice(0, cut).trimEnd(), ...breakLong(s.slice(cut + 1), max)];
}

/* 이어 쓰기: 빈 줄로 나뉜 문단 안의 줄바꿈을 모두 없애고 한 줄로 (문단 사이 빈 줄은 그대로) */
function joinText(text) {
  const out = []; let cur = [];
  const flush = () => { if (cur.length) { out.push(cur.join(' ')); cur = []; } };
  for (const raw of String(text == null ? '' : text).split(/\r?\n/)) {
    const line = raw.replace(/[ \t\u00a0\u200b]+/g, ' ').trim();
    if (!line) { flush(); out.push(''); continue; }
    cur.push(line);
  }
  flush();
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/* 글 한 덩어리 → 정리된 글. opt.mode 'join' 이면 줄바꿈 없이 이어 쓰기 · opt.max 한 줄 최대 글자 · opt.sentences(기본 true) 문장마다 줄바꿈 */
function tidyText(text, opt) {
  if (opt && opt.mode === 'join') return joinText(text);
  const max = clampMax(opt && opt.max), sentences = !opt || opt.sentences !== false;
  const out = [];
  for (const raw of String(text == null ? '' : text).split(/\r?\n/)) {
    const line = raw.replace(/[ \t ​]+/g, ' ').trim();
    if (!line) { out.push(''); continue; }
    const ss = line.split(SENT_END).map(x => x.trim()).filter(Boolean);
    if (sentences) { for (const s of ss) out.push(...breakLong(s, max)); continue; }
    let cur = '';                                                       // 끄면: 문장을 이어 붙이다가 max 를 넘으려 할 때만 줄을 바꿈
    for (const s of ss) {
      if (s.length > max) { if (cur) { out.push(cur); cur = ''; } out.push(...breakLong(s, max)); continue; }
      if (cur && cur.length + 1 + s.length > max) { out.push(cur); cur = s; } else cur = cur ? cur + ' ' + s : s;
    }
    if (cur) out.push(cur);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
/* 줄 하나가 max 를 넘는 곳 수 (원고 점검에서 써요) */
const longLines = (text, max) => String(text || '').split(/\r?\n/).filter(l => l.trim().length > clampMax(max)).length;

const api = { tidyText, joinText, longLines, DEF_MAX, clampMax };
if (typeof module !== 'undefined' && module.exports) module.exports = api;

/* ───── 화면 ───── */
if (root && root.KK && root.document) {
  const KK = root.KK, $ = id => root.document.getElementById(id);
  const get = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (_) { return d; } };
  const put = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };
  KK.tidyText = tidyText; KK.longLines = longLines;
  /* 줄바꿈 방식은 브랜드마다 따로 기억해요 — 키친앤코 기본은 줄바꿈 없이 이어 쓰기, 레몬하우스 기본은 문장마다 한 줄(기존 문체). 브랜드는 나중에 정해지거나 바뀌므로 쓸 때마다 확인해요 */
  const brandNow = () => KK.brandKey === 'lemon' ? 'lemon' : 'kk', defModeNow = () => brandNow() === 'lemon' ? 'sentence' : 'join';
  const modeOf = v => v === 'join' || v === 'sentence' ? v : defModeNow();
  KK.lineOpt = () => ({ max: clampMax($('lineMax') ? $('lineMax').value : get('kk-line-max', DEF_MAX)), sentences: true, mode: modeOf($('lineMode') ? $('lineMode').value : get('kk-line-mode-' + brandNow(), defModeNow())) });
  const syncMode = () => { if (!$('lineMode')) return; const j = $('lineMode').value === 'join'; $('lineMax').disabled = j; $('lineMaxWrap').style.opacity = j ? '.45' : ''; };
  KK.lineSyncMode = () => { if (!$('lineMode')) return; $('lineMode').value = modeOf(get('kk-line-mode-' + brandNow(), defModeNow())); syncMode(); };   // 브랜드를 바꾸면 그 브랜드의 방식으로
  KK.lineJoin = () => KK.tidyOn() && KK.lineOpt().mode === 'join';                    // 보낼 때 줄바꿈 없이 이어 붙이는 중인지 (원고 점검·글 만들기에서 써요)
  KK.tidyOn = () => $('optTidy') ? $('optTidy').checked : get('kk-line-tidy', '1') === '1';
  /* 모든 문단의 줄을 정리해서 글 칸에 반영 → 바뀐 문단 수 */
  KK.tidyAll = () => {
    const o = KK.lineOpt(); let n = 0;
    for (const c of KK.state.cards) { const t = tidyText(c.text, o); if (t !== String(c.text || '').trim()) { c.text = t; c.edited = true; n++; } /* 자동 문장도 정리한 모양 그대로 남도록 '직접 고친 문단'으로 표시 (원래대로 되돌리기는 카드에서) */ }
    if (n) KK.changed('structure');
    return n;
  };
  const init = () => {
    if (!$('lineMax')) return;
    $('lineMax').value = clampMax(get('kk-line-max', DEF_MAX));
    $('optTidy').checked = get('kk-line-tidy', '1') === '1';
    KK.lineSyncMode();
    $('lineMax').addEventListener('change', () => { $('lineMax').value = clampMax($('lineMax').value); put('kk-line-max', $('lineMax').value); KK.renderCheck && KK.state && KK.changed('typing'); });
    $('optTidy').addEventListener('change', () => put('kk-line-tidy', $('optTidy').checked ? '1' : '0'));
    $('lineMode').addEventListener('change', () => { put('kk-line-mode-' + brandNow(), modeOf($('lineMode').value)); syncMode(); KK.state && KK.changed('structure'); });
    $('tidyNow').addEventListener('click', () => {
      if (!KK.state.cards.some(c => String(c.text || '').trim())) return KK.toast('정리할 글이 아직 없어요.', 'error');
      const n = KK.tidyAll();
      const j = KK.lineOpt().mode === 'join';
      KK.toast(n ? (j ? '문단 ' + n + '개의 줄바꿈을 없애 한 덩어리로 이어 붙였어요.' : '문단 ' + n + '개의 줄을 정리했어요 (한 줄 최대 ' + KK.lineOpt().max + '자).') : '이미 정리돼 있어요.', 'ok');
    });
  };
  init();
}
})(typeof window !== 'undefined' ? window : null);
