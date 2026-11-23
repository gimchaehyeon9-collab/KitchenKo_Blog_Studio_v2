/* 원고 점검 — 글을 쓴 뒤 놓치기 쉬운 것을 자동으로 찾아서 알려 줘요 (고치지는 않고 표시만 해요)
   ① 면적 표기: ㎡ · m2 · m² · 제곱미터 · PY · 평형 · 평대 가 숫자 뒤에 붙은 곳 (저장소 naver-blog-auto 와 같은 규칙. 키워드에 적은 말은 제외)
   ② 비어 있는 공간 설명  ③ 문장 중간에서 줄이 바뀐 곳(끊긴 문장) · 한 줄이 너무 길어 네이버에서 꺾일 곳  ④ 반복: 똑같은 문장 · 같은 말로 시작하는 문단 · 한 문단 안의 같은 끝말
   브라우저에서는 KK.checkDraft / KK.renderCheck 로, 테스트에서는 require 로 불러 써요. */
(function (root) {
'use strict';

const AREA = /\d[\d,.]*\s*(?:㎡|m\s*(?:²|2|\^\s*2)|(?:제곱|평방)\s*미터|sq\.?\s*m|py\b|평(?:형|대))/iu;
const AREA_G = new RegExp(AREA.source, 'giu');
// 줄이 이 말로 끝나면 문장이 아직 안 끝난 거예요 — 쉼표 · 이어 주는 말(…하고, …해서, …지만) · 조사(…을, …에서, …로)
const OPEN_END = /(?:[,，、]|(?:으로|에서|에게|까지|부터|보다|처럼|이며|으며|이고|하고|하며|해서|하여|라서|이라|인데|는데|지만|니까|다가|더니|으나|면서|으면|이면|려고|도록|거나|든지)|[을를은는이가에의와과도로고며면서])$/;
// 한 문장이 길어서 쉼표·이어 주는 말(…했으며,) 뒤에서 일부러 나눈 줄은 끊긴 문장이 아니에요 (조사에서 끊긴 건 그대로 알려 줘요)
const CLAUSE_END = /(?:[,，、]|이며|으며|이고|하고|하며|해서|하여|라서|이라|인데|는데|지만|니까|다가|더니|으나|면서|으면|이면|려고|도록|거나|든지|고요|한데)$/u;
const SKIP_LINE = /^[\s#※·•\-*\[\(]|[:：]$/;
const strip = t => String(t || '').replace(/[\s​]+/g, '');
const flat = t => strip(t).replace(/[.!?~…·,，。"'“”‘’()\[\]]/g, '');
const lines = t => String(t || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
const sentences = t => String(t || '').replace(/\r?\n/g, ' ').split(/(?<=[.!?…~])\s+/).map(x => x.trim()).filter(Boolean);
const ctx = (text, i, n) => { const a = Math.max(0, i - 8), b = Math.min(text.length, i + n + 8); return (a ? '…' : '') + text.slice(a, b).replace(/\s+/g, ' ') + (b < text.length ? '…' : ''); };
const label = (c, i) => (i + 1) + '번' + (c && (c.spaceName || c.space) ? ' · ' + (c.spaceName || (typeof c.space === 'string' ? c.space : '')) : '');

/* 키워드로 적어 둔 말(예: "메트로시티 34평")은 면적 표기 검사에서 빼요 */
function withoutKeywords(text, words) {
  let t = String(text || '');
  for (const w of (words || []).filter(x => x && String(x).trim().length >= 2).sort((a, b) => String(b).length - String(a).length)) t = t.split(String(w)).join(' '.repeat(Math.min(4, String(w).length)));
  return t;
}

function areaIssues(where, text, kwWords, extra) {
  const out = [], t = withoutKeywords(text, kwWords); let m; AREA_G.lastIndex = 0;
  while ((m = AREA_G.exec(t))) { out.push(Object.assign({ level: 'bad', kind: 'area', where, msg: '면적 표기 「' + m[0].replace(/\s+/g, '') + '」 — 평형·㎡ 숫자는 쓰지 않기로 했어요. 빼거나 꼭 필요하면 \'34평\'처럼만 써 주세요.', snippet: ctx(t, m.index, m[0].length) }, extra || {})); if (out.length >= 3) break; }
  return out;
}

/* s: KK.state (cards[].text …) · doc: KK.compose(s) 결과 (title, greeting, footer, tags, kw) */
function checkDraft(s, doc, opt) {
  const lineMax = Math.max(20, Math.min(120, Number(opt && opt.lineMax) || 50)), joinMode = !!(opt && opt.join);   // joinMode: 보낼 때 줄바꿈을 모두 없애 이어 붙이니 줄바꿈·줄 길이 점검은 건너뜀
  const cards = (s && s.cards) || [], issues = [], kw = (doc && doc.kw) || {}, kwWords = [kw.A, kw.B, s && s.apt, s && s.kwA, s && s.kwB].filter(Boolean);
  const written = cards.filter(c => String(c.text || '').trim());
  if (!cards.length || !written.length) return { state: 'empty', issues, counts: { bad: 0, warn: 0, info: 0 } };

  // ① 면적 표기 — 제목 · 인사말 · 문단 · 마무리 · 태그
  if (doc) {
    issues.push(...areaIssues('제목', doc.title, kwWords));
    issues.push(...areaIssues('인사말', doc.greeting, kwWords));
    issues.push(...areaIssues('마무리', doc.footer, kwWords));
    issues.push(...areaIssues('태그', (doc.tags || []).map(x => '#' + x).join(' '), kwWords));
  }
  cards.forEach((c, i) => issues.push(...areaIssues(label(c, i), c.text, kwWords, { card: c.id, i })));

  // ② 비어 있는 공간 설명
  cards.forEach((c, i) => { if (!String(c.text || '').trim()) issues.push({ level: 'bad', kind: 'empty', where: label(c, i), card: c.id, i, msg: '설명 글이 비어 있어요. 사진 순서대로 글이 들어가니 비워 두면 사진만 올라가요.' }); });

  // ③ 문장 중간 줄바꿈 / 끊긴 글
  if (!joinMode) cards.forEach((c, i) => {
    const ls = lines(c.text); let n = 0; const tidy = ls.length > 1 && ls.every(x => x.length <= lineMax);
    ls.forEach((ln, k) => {
      if (n >= 2 || SKIP_LINE.test(ln) || ln.length < 6 || !OPEN_END.test(ln)) return;
      if (k < ls.length - 1 && ln.length + 1 + ls[k + 1].length > lineMax && (CLAUSE_END.test(ln) || tidy)) return;   // 한 줄에 다 안 들어가서 일부러 나눈 것 (모든 줄이 한 줄 최대 안이면 [줄 정리]를 한 글이라 조사 뒤에서 나눈 것도 그대로 둠)
      n++;
      issues.push({ level: 'warn', kind: 'break', where: label(c, i), card: c.id, i, snippet: '…' + ln.slice(-16),
        msg: k < ls.length - 1 ? '문장이 끝나기 전에 줄이 바뀐 것 같아요 — 「…' + ln.slice(-12) + '」 뒤에서 줄을 바꿨어요. 줄바꿈은 문장이 끝난 뒤에만 넣어 주세요.' : '글이 문장 중간에서 끝난 것 같아요 — 「…' + ln.slice(-12) + '」' });
    });
  });

  // ③-2 한 줄이 너무 길어 네이버에서 글자 중간이 꺾일 곳
  if (!joinMode) cards.forEach((c, i) => {
    const long = lines(c.text).filter(ln => ln.length > lineMax); if (!long.length) return;
    issues.push({ level: 'info', kind: 'long', where: label(c, i), card: c.id, i, snippet: long[0].slice(0, 20),
      msg: '한 줄이 ' + lineMax + '자를 넘는 곳이 ' + long.length + '줄 있어요 — 네이버에서 「' + long[0].slice(Math.max(0, lineMax - 6), lineMax + 4) + '」처럼 말 중간에서 줄이 꺾일 수 있어요. [줄 정리]를 누르면 문장마다 나눠 줘요 (보낼 때도 자동으로 해요).' });
  });

  // ④ 반복
  const seen = new Map();   // 똑같은 문장 → 처음 나온 카드 번호
  cards.forEach((c, i) => {
    let n = 0;
    for (const st of sentences(c.text)) {
      const k = flat(st); if (k.length < 12) continue;
      if (seen.has(k)) { if (n++ < 2) issues.push({ level: 'warn', kind: 'dup', where: label(c, i), card: c.id, i, snippet: st.slice(0, 40), msg: '앞에서 쓴 문장이 그대로 또 나와요 — 「' + st.slice(0, 28) + (st.length > 28 ? '…' : '') + '」 (' + (seen.get(k) === i ? '같은 문단 안' : (seen.get(k) + 1) + '번과 같음') + ')' }); }
      else seen.set(k, i);
    }
  });
  const starts = new Map();
  cards.forEach((c, i) => { const f = flat(String(c.text || '').trim()).slice(0, 7); if (f.length >= 6) (starts.get(f) || starts.set(f, []).get(f)).push(i); });
  for (const [, idx] of starts) if (idx.length >= 3) issues.push({ level: 'info', kind: 'start', where: idx.map(x => (x + 1) + '번').join('·'), card: cards[idx[0]].id, i: idx[0], msg: idx.length + '개 문단이 같은 말로 시작해요 — 「' + String(cards[idx[0]].text).trim().slice(0, 12) + '…」. 시작을 조금씩 바꾸면 덜 반복돼 보여요.' });
  // 권유하는 끝말(…해 보세요, …추천드립니다)이 한 문단에 계속 이어질 때만 알려요 (…했습니다 같은 보통 끝말은 말투라서 세지 않아요)
  const PUSH = /(보세요|주세요|하세요|드립니다|드려요|바랍니다|추천해요|해요)[.!?~…]*$/;
  cards.forEach((c, i) => {
    const ss = sentences(c.text); if (ss.length < 3) return;
    const ends = new Map(); for (const x of ss) { const m = PUSH.exec(strip(x)); if (m) ends.set(m[1], (ends.get(m[1]) || 0) + 1); }
    const top = [...ends].sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] >= 3 && top[1] >= Math.ceil(ss.length * 0.6)) issues.push({ level: 'info', kind: 'ending', where: label(c, i), card: c.id, i, msg: '문장 ' + ss.length + '개 중 ' + top[1] + '개가 「…' + top[0] + '」로 끝나요. 권유하는 말이 계속 이어지면 단조로워 보일 수 있어요. 말투 습관이면 그대로 두세요.' });
  });

  const counts = { bad: 0, warn: 0, info: 0 }; for (const x of issues) counts[x.level]++;
  return { state: counts.bad ? 'bad' : counts.warn ? 'warn' : counts.info ? 'info' : 'ok', issues, counts };
}

const api = { checkDraft, AREA, OPEN_END, CLAUSE_END };
if (typeof module !== 'undefined' && module.exports) module.exports = api;

/* ───── 화면 ───── */
if (root && root.KK && root.document) {
  const KK = root.KK, esc = KK.esc, $ = KK.$;
  KK.checkDraft = checkDraft;
  KK.renderCheck = (s, doc) => {
    const box = $('checkList'), pill = $('checkPill'); if (!box || !pill) return;
    let r; try { r = checkDraft(s, doc, { lineMax: KK.lineOpt ? KK.lineOpt().max : 50, join: !!(KK.lineJoin && KK.lineJoin()) }); } catch (e) { box.innerHTML = '<p class="muted">점검 중 문제가 생겼어요: ' + esc(e.message) + '</p>'; return; }
    const LV = { bad: '고칠 곳', warn: '확인', info: '참고' };
    if (r.state === 'empty') { pill.textContent = '글을 쓰면 점검해요'; pill.className = 'pill'; box.innerHTML = ''; return; }
    const n = r.counts.bad + r.counts.warn;
    pill.textContent = r.state === 'ok' ? '문제 없음' : (n ? (r.counts.bad ? '고칠 곳 ' + r.counts.bad + '건' : '확인 ' + r.counts.warn + '건') : '참고 ' + r.counts.info + '건');
    pill.className = 'pill ' + (r.state === 'ok' ? 'ok' : r.state === 'info' ? '' : 'bad');
    const show = r.issues.slice(0, 14);
    box.innerHTML = r.state === 'ok' ? '<p class="muted">면적 표기·빈 설명·끊긴 문장·긴 줄·반복 표현을 확인했어요. 이상 없어요.</p>'
      : show.map(x => `<button type="button" class="ck ${x.level}" ${x.card ? `data-ck="${esc(x.card)}"` : ''}><em>${LV[x.level]}</em><b>${esc(x.where)}</b><span>${esc(x.msg)}</span></button>`).join('')
        + (r.issues.length > show.length ? `<p class="muted">그 밖에 ${r.issues.length - show.length}건이 더 있어요.</p>` : '');
  };
  root.document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-ck]'); if (!b) return;
    const el = root.document.querySelector('.card[data-card="' + (root.CSS && CSS.escape ? CSS.escape(b.dataset.ck) : b.dataset.ck) + '"]');
    if (el && root.KK && root.KK.goStep) root.KK.goStep(3);           // 단계별 화면에서는 그 문단이 있는 [글 쓰기] 단계로
    if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('ck-flash'); setTimeout(() => el.classList.remove('ck-flash'), 1600); }
  });
}
})(typeof window !== 'undefined' ? window : null);
