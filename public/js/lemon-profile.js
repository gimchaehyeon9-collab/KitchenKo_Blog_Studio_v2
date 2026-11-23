/* 레몬하우스 — 블로그별 문체·서식
   · 블로그 번호마다 따로 저장 (서버 파일 lemon-profiles.json): 글 틀(제목·인사말·공간 이름·소제목 모양·마무리) + 문체 예시
   · [내 글에서 서식 가져오기] — 네이버에서 [수정]으로 열어 둔 내 글을 읽기만 해서 서식과 말투 예시를 저장
   · 글쓰기(compose)·미리보기·Claude 요청문·네이버 서식 적용(restyle)이 이 프로필을 따라가요 */
(() => {
'use strict';
const KK = window.KK;
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const isLemon = () => KK.brandKey === 'lemon';

/* ───────── 기본값 ───────── */
const DEFAULTS = () => ({
  titlePattern: '{region} 인테리어 추천 | {apt}, {subtitle}',
  subtitles: '',
  greeting: '안녕하세요, 레몬하우스입니다.\n오늘은 {apt} 아파트 인테리어를 소개해 드리려고 합니다.',
  spaces: '현관, 거실, 주방, 안방, 안방 욕실, 작은방 1, 작은방 2, 공용 욕실',
  extraTags: '',
  videoSuffix: '',
  headingMode: 'auto',
  headingWrap: '{name}',
  emphMode: 'auto',
  closing: '', phone: '', phoneColor: '#f26522',
  lines: '3~4', samples: '', tone: '',
  template: null, tplInfo: null
});
let P = DEFAULTS();              // 지금 쓰는 프로필
let curBlog = '';                // 프로필이 속한 블로그 번호 ('' = 아직 안 고름)
let loaded = false, saveTimer = 0, dirtySave = false;
KK.lemonProfile = P;
const profKey = () => curBlog || 'default';

/* ───────── 문자열 도우미 ───────── */
const regionOf = s => String(s.region || '').trim().split(/\s+/).slice(0, 2).join(' ');
const varsOf = s => ({ apt: String(s.apt || '').trim(), region: regionOf(s) });
const fillV = (t, V) => String(t == null ? '' : t).replace(/\{apt\}/g, V.apt || '○○').replace(/\{region\}/g, V.region || '○○');
const lines = t => String(t || '').split('\n').map(x => x.replace(/\s+$/, ''));
const list = t => String(t || '').split(/[,\n]/).map(x => x.trim()).filter(Boolean);

/* ───────── 내 글에서 읽어 온 데이터 → 프로필 ───────── */
const ct = c => c && c['@ctype'];
const paras = c => Array.isArray(c && c.value) ? c.value : [];
const nodesOf = c => paras(c).flatMap(p => p.nodes || []);
const textOf = c => paras(c).map(p => (p.nodes || []).map(n => n.value || '').join('')).join('\n');
const isBlank = c => !textOf(c).trim();
const isMedia = c => ct(c) === 'image' || ct(c) === 'imageGroup';
const FOOTER_TYPES = ['horizontalLine', 'text', 'oglink', 'quotation'];
const EMKEYS = ['bold', 'underline', 'italic', 'strikeThrough', 'fontColor', 'backgroundColor', 'fontSizeCode'];
const sig = st => JSON.stringify(EMKEYS.map(k => { const v = st && st[k]; return v === false || v == null ? null : v; }));

/* 글 덩어리들의 글자 서식: 가장 많이 쓰인 것 = 기본, 그다음 다른 서식 = 강조(굵게·밑줄·형광펜 등) */
function styleInfo(comps) {
  const nodes = comps.flatMap(nodesOf).filter(n => String(n.value || '').trim());
  const by = new Map();
  for (const n of nodes) {
    const k = sig(n.style), e = by.get(k) || { style: n.style || {}, len: 0, words: [] };
    e.len += n.value.length; e.words.push(String(n.value).trim()); by.set(k, e);
  }
  const all = [...by.values()].sort((a, b) => b.len - a.len);
  if (!all.length) return null;
  const emp = all.slice(1).sort((a, b) => b.words.length - a.words.length)[0];
  return { main: clone(all[0].style), em: emp ? clone(emp.style) : null, emWords: emp ? [...new Set(emp.words)] : [] };
}
const paraStyleOf = comps => {
  for (const c of comps) for (const p of paras(c)) if ((p.nodes || []).some(n => String(n.value || '').trim()) && p.style) return clone(p.style);
  return null;
};
const titleOf = c => c ? (c.title || []).map(p => (p.nodes || []).map(n => n.value || '').join('')).join(' ').trim() : '';

/* 제목 모양 추정: "{지역} 인테리어 추천 | {아파트}, {부제}" */
function guessTitle(t) {
  const bar = t.search(/[|｜]/);
  if (bar <= 0) return { pattern: '', apt: '', region: '' };
  const left = t.slice(0, bar).trim(), right = t.slice(bar + 1).trim();
  const comma = right.search(/[,，]/);
  const apt = (comma > 0 ? right.slice(0, comma) : right).trim();
  const sub = comma > 0 ? right.slice(comma + 1).trim() : '';
  const region = left.replace(/\s*인테리어.*$/, '').trim();
  if (!apt) return { pattern: '', apt: '', region: '' };
  const lp = region && left.startsWith(region) ? '{region}' + left.slice(region.length) : left;
  return { pattern: lp + ' | {apt}' + (sub ? ', {subtitle}' : ''), apt, region: region && left.startsWith(region) ? region : '' };
}

KK.lemonParseCapture = raw => {
  const eds = (raw && raw.editors) || [];
  const data = eds.map(e => e && e.data).find(d => d && d.document && Array.isArray(d.document.components) && d.document.components.length);
  if (!data) return { ok: false, error: '글 내용을 읽지 못했어요. 네이버에서 내 글을 [수정]으로 열어 편집 화면이 보이는 상태에서 다시 눌러 주세요.' };
  const comps = data.document.components;
  const titleComp = comps.find(c => ct(c) === 'documentTitle');
  const titleText = titleOf(titleComp);
  const iCover = comps.findIndex(isMedia);
  if (iCover < 0) return { ok: false, error: '사진이 들어 있는 글에서 가져와 주세요. (사진 없는 글에서는 서식을 알 수 없어요)' };
  const iM1 = comps.findIndex((c, i) => i > iCover && isMedia(c));
  if (iM1 < 0) return { ok: false, error: '대표사진 말고 공간별 사진이 더 들어 있는 글에서 가져와 주세요.' };

  // 머리말: 대표사진 ~ 첫 공간 사진 사이 (인사말 · 구분선 · 첫 소제목)
  const pre = comps.slice(iCover + 1, iM1);
  const iLine = pre.findIndex(c => ct(c) === 'horizontalLine'), iQ = pre.findIndex(c => ct(c) === 'quotation');
  const cut = [iLine, iQ].filter(i => i >= 0).sort((a, b) => a - b)[0];
  const head = cut == null ? pre : pre.slice(0, cut);
  const greetComp = [...head].reverse().find(c => ct(c) === 'text' && !isBlank(c));
  const afterLine = iLine >= 0 && (iQ < 0 || iLine < iQ) ? (pre[iLine].layout || 'line1') : null;

  // 공간 구간: 소제목(인용구) 또는 사진 묶음마다
  const secs = []; let cur = null;
  for (let k = iCover + 1; k < comps.length; k++) {
    const c = comps[k], t = ct(c);
    if (t === 'quotation') { cur = { name: textOf(c).trim(), media: 0, para: null }; secs.push(cur); }
    else if (isMedia(c)) { if (!cur || cur.para) { cur = { name: '', media: 0, para: null }; secs.push(cur); } cur.media++; }
    else if (t === 'text' && cur && cur.media && !cur.para && !isBlank(c)) cur.para = c;
  }
  const withPara = secs.filter(x => x.para);
  if (!withPara.length) return { ok: false, error: '사진 아래 설명 글을 찾지 못했어요. 사진마다 설명이 달린 글에서 가져와 주세요.' };
  const quote = comps.find((c, i) => i > iCover && ct(c) === 'quotation');

  // 마무리: 마지막 설명 글 뒤부터
  const iLastPara = comps.indexOf(withPara[withPara.length - 1].para);
  let footer = comps.slice(iLastPara + 1).filter(c => FOOTER_TYPES.includes(ct(c)));
  while (footer.length && ct(footer[footer.length - 1]) === 'text' && isBlank(footer[footer.length - 1])) footer.pop();
  const skippedFooter = comps.slice(iLastPara + 1).filter(c => ['image', 'imageGroup', 'placesMap'].includes(ct(c))).length;

  // 글자 서식
  const gi = greetComp ? styleInfo([greetComp]) : null, bi = styleInfo(withPara.map(x => x.para));
  const tnode = titleComp && (titleComp.title || [])[0];
  const T = {
    lemon: true,
    titleStyle: { align: tnode && tnode.style && tnode.style.align || 'center', node: tnode && tnode.nodes && tnode.nodes[0] && tnode.nodes[0].style ? clone(tnode.nodes[0].style) : { '@ctype': 'nodeStyle', fontFamily: 'nanumgothic', fontSizeCode: 'fs26' } },
    greetNode: gi ? gi.main : null, greetPara: greetComp ? paraStyleOf([greetComp]) : null, greetEm: gi ? gi.em : null,
    bodyNode: bi ? bi.main : null, bodyPara: paraStyleOf(withPara.map(x => x.para)), bodyEm: bi ? bi.em : null,
    afterGreetingLine: afterLine,
    heading: quote ? { proto: clone(quote) } : null,
    footer: clone(footer), footerText: footer.filter(c => ct(c) === 'text').flatMap(c => textOf(c).split('\n')).map(x => x.trim()).filter(Boolean)
  };

  // 글에 들어 있던 이름을 {apt}·{region} 자리표시로 바꿔 인사말·강조어에 쓰기
  const g = guessTitle(titleText);
  const ph = s => { let r = String(s); if (g.apt) r = r.split(g.apt).join('{apt}'); if (g.region) r = r.split(g.region).join('{region}'); return r; };
  const keepEm = ws => [...new Set((ws || []).map(ph).filter(w => /\{apt\}|\{region\}|레몬하우스/.test(w)))];
  T.greetEmWords = gi ? keepEm(gi.emWords) : [];
  T.bodyEmWords = bi ? keepEm(bi.emWords) : [];

  // 말투 예시: 읽어 온 글 그대로 (제목 · 인사말 · 공간별 소제목+설명 · 마무리)
  const sample = ['제목: ' + titleText, '', greetComp ? textOf(greetComp).trim() : ''];
  for (const x of withPara) sample.push('', x.name ? '[' + x.name + ']' : '', textOf(x.para).trim());
  if (T.footerText.length) sample.push('', T.footerText.join('\n'));

  return {
    ok: true, template: T, titlePattern: g.pattern, apt: g.apt, region: g.region,
    greeting: greetComp ? lines(ph(textOf(greetComp))).join('\n').trim() : '',
    spaces: withPara.map(x => x.name).filter(Boolean),
    sample: sample.filter((x, i, a) => !(x === '' && a[i - 1] === '')).join('\n').trim(),
    info: { sections: withPara.length, headings: !!quote, line: !!afterLine, footer: footer.length, em: !!(T.greetEm || T.bodyEm), skippedFooter, title: titleText }
  };
};

/* ───────── 템플릿 만들기 (가져온 서식 + 직접 적은 칸) ───────── */
const NODE = { '@ctype': 'nodeStyle', fontFamily: 'nanumbarungothic' };
const PARA = { '@ctype': 'paragraphStyle', align: 'center', lineHeight: 1.8 };
const mkText = (ls, node, para) => ({ '@ctype': 'text', id: 'x', layout: 'default', value: ls.map(l => ({ '@ctype': 'paragraph', id: 'x', style: clone(para), nodes: [{ '@ctype': 'textNode', id: 'x', style: clone(node), value: l }] })) });
function fallbackTemplate(p) {
  const footer = [];
  const cl = lines(p.closing).filter(x => x.trim()), ph = String(p.phone || '').trim();
  if (cl.length || ph) footer.push({ '@ctype': 'horizontalLine', id: 'x', align: 'center', layout: 'line5' });
  if (cl.length) footer.push(mkText(cl, { ...NODE, fontColor: '#777777' }, PARA));
  if (ph) footer.push(mkText([ph], { ...NODE, bold: true, fontColor: p.phoneColor || '#f26522' }, PARA));
  return {
    lemon: true, titleStyle: { align: 'center', node: { '@ctype': 'nodeStyle', fontFamily: 'nanumgothic', fontSizeCode: 'fs26' } },
    greetNode: { ...NODE, fontColor: '#777777' }, greetPara: clone(PARA), greetEm: null, bodyNode: clone(NODE), bodyPara: clone(PARA), bodyEm: null,
    afterGreetingLine: 'line1', heading: null, footer, footerText: [...cl, ph].filter(Boolean), greetEmWords: [], bodyEmWords: []
  };
}
function templateOf(p) {
  const base = fallbackTemplate(p), c = p.template;
  const T = Object.assign({}, base);
  if (c) {
    for (const k of Object.keys(c)) if (c[k] != null && !(Array.isArray(c[k]) && !c[k].length)) T[k] = c[k];
    if (!T.footer || !T.footer.length) { T.footer = base.footer; T.footerText = base.footerText; }
    if (c.afterGreetingLine == null) T.afterGreetingLine = null;     // 가져온 글에 구분선이 없었으면 넣지 않음
  }
  T.lemon = true;
  const mode = p.headingMode || 'auto';
  if (mode !== 'auto') T.heading = null;
  const bold = ns => ns ? { ...ns, bold: true } : { ...NODE, bold: true };
  const em = p.emphMode || 'auto';
  if (em === 'off') { T.greetEm = null; T.bodyEm = null; }
  else if (em === 'bold') { T.greetEm = bold(T.greetNode); T.bodyEm = bold(T.bodyNode); }
  return T;
}
KK.lemonTemplate = () => templateOf(P);

/* ───────── 글 만들기 (KK.compose 의 레몬 버전) ───────── */
const spaceList = () => list(P.spaces);
function assignSpaces(s) {
  const sp = spaceList();
  (s.cards || []).forEach((c, i) => { if (!c.spaceManual) c.spaceName = sp[i] || ''; });
}
const compact = t => String(t || '').replace(/\s+/g, '');
KK.lemonTags = s => {
  const V = varsOf(s), apt = compact(V.apt);
  if (!apt) return [];
  const tags = [apt, apt + '인테리어'];
  if (V.region) tags.push(compact(V.region) + '인테리어');
  for (const t of String(P.extraTags || '').split(/[,\s#]+/).map(x => x.trim()).filter(Boolean)) tags.push(compact(fillV(t, V)));
  return [...new Set(tags.filter(Boolean))].slice(0, 30);
};
KK.lemonHeadingText = name => {
  if (!name) return '';
  const w = String(P.headingWrap || '{name}');
  return w.includes('{name}') ? w.replace(/\{name\}/g, name) : w + name;
};
/* 추천 제목 형식 — 사진·글에 없는 내용(가격·평수·공사 범위 등)은 지어내지 않고, 지역·단지명·공간 이름만 써요.
   {region} 지역 · {apt} 단지명 · {sp1}/{sp2} 사진에서 나눈 공간 이름(있을 때만 쓰는 형식) */
const TITLE_FORMS = [
  { kind: '지역 검색형', t: '{region} 인테리어 추천 | {apt} 아파트 시공 사례' },
  { kind: '단지명 앞세움', t: '{apt} 인테리어 | {region} 아파트 리모델링 추천' },
  { kind: '공간 강조형', t: '{apt} {sp1} 인테리어, 레몬하우스가 제안한 {sp2} 구성', need: 'sp2' },
  { kind: '질문형', t: '{apt} 인테리어, 어떻게 달라졌을까요? {region} 시공 사례' },
  { kind: '후기형', t: '{region} {apt} 리모델링 후기 | 레몬하우스 인테리어' },
  { kind: '정보형', t: '{region} 인테리어 업체 추천 | {apt} 시공 사진 모아보기' },
  { kind: '공간 한 곳 소개', t: '{apt} {sp1} 인테리어 | {region} 레몬하우스 시공', need: 'sp1' },
  { kind: '감성형', t: '{apt}, 우리 집이 새로워지는 시간 | {region} 인테리어' }
];
KK.LEMON_TITLE_FORMS = TITLE_FORMS;
KK.lemonCompose = s => {
  const V = varsOf(s), kw = KK.keywords(s);
  assignSpaces(s);
  const mk = sub => {
    let t = fillV(P.titlePattern || DEFAULTS().titlePattern, V);
    t = sub ? t.replace(/\{subtitle\}/g, sub) : t.replace(/[\s,，]*\{subtitle\}/g, '');
    return t.replace(/\s{2,}/g, ' ').replace(/[\s,，|｜]+$/, '').trim();
  };
  const subs = String(P.subtitles || '').split('\n').map(x => x.trim()).filter(Boolean);   // 줄마다 하나
  const mine = (subs.length ? subs.map(mk) : [mk('')]).filter(Boolean).slice(0, 3);
  if (!mine.length) mine.push(mk(''));
  // 내 형식 뒤에 추천 형식을 더해 7개까지 보여 줘요 (내 형식이 맨 앞이라 처음 고른 제목은 전과 같아요)
  const spaces = [...new Set((s.cards || []).map(c => c.spaceName).filter(Boolean))];
  const sp1 = spaces[0] || '', sp2 = spaces.find(x => x !== sp1) || '';
  const titles = [...mine], titleKinds = mine.map(() => '내 형식'), seenT = new Set(mine.map(x => x.replace(/\s/g, '')));
  for (const f of TITLE_FORMS) {
    if (titles.length >= 7) break;
    if ((f.need === 'sp1' && !sp1) || (f.need === 'sp2' && !sp2)) continue;
    const t = fillV(f.t, V).replace(/\{sp1\}/g, sp1).replace(/\{sp2\}/g, sp2).replace(/\s{2,}/g, ' ').trim();
    const key = t.replace(/\s/g, ''); if (seenT.has(key)) continue;
    seenT.add(key); titles.push(t); titleKinds.push(f.kind);
  }
  const title = (s.title || '').trim() || titles[(s.titlePick ?? 0) % titles.length];
  const T = templateOf(P), headMode = P.headingMode || 'auto';
  return {
    lemon: true, title, titles, titleKinds, specLines: [], greeting: fillV(P.greeting, V),
    footer: (T.footerText || []).join('\n'), homepage: '', tags: KK.hashtags(s), kw,
    headings: (s.cards || []).map(c => headMode === 'none' || c.spaceCont ? '' : (c.spaceName || '')),
    videoTitle: title + (P.videoSuffix ? ' ' + String(P.videoSuffix).trim() : '')
  };
};

/* 레몬 모드의 기본 키워드: A = 아파트명, B = 아파트명 인테리어 */
{
  const orig = KK.defaultKeywords;
  KK.defaultKeywords = s => {
    if (!isLemon()) return orig(s);
    const apt = (s.apt || '').trim();
    return { A: apt, B: apt ? apt + ' 인테리어' : '' };
  };
}

/* ───────── 네이버로 보낼 서식 묶음 ───────── */
KK.lemonRestyle = (doc, s, extra) => {
  const V = varsOf(s), T = clone(templateOf(P));
  const fillW = ws => (ws || []).map(w => fillV(w, V)).filter(w => w && !/○○/.test(w));
  const bold = (P.emphMode || 'auto') === 'bold';
  const greetWords = fillW(T.greetEmWords && T.greetEmWords.length ? T.greetEmWords : (bold ? ['레몬하우스', '{apt}'] : []));
  const bodyWords = fillW(T.bodyEmWords && T.bodyEmWords.length ? T.bodyEmWords : (bold ? ['{apt}', '{region} 인테리어'] : []));
  const headings = s.cards.map((c, i) => {
    const n = doc.headings[i] || '';
    return T.heading ? n : KK.lemonHeadingText(n);
  });
  return Object.assign({
    mode: 'lemon', template: T, spec: [], greeting: doc.greeting.split('\n'), headings, vars: V, greetWords, bodyWords,
    groups: s.cards.map(c => c.photoIds.length > 1 ? c.photoIds.length : 1), cards: s.cards.map(c => c.text.trim())
  }, extra || {});
};

/* ───────── 미리보기 ───────── */
KK.lemonPreviewHtml = (doc, s) => {
  const T = templateOf(P), para = t => esc(t).replace(/\n/g, '<br>');
  const cover = KK.coverData ? `<img class="pv-cover" src="${KK.coverData}" alt="대표사진">` : '<div class="pv-empty">대표사진 1:1</div>';
  let h = `<h1 class="pv-title">${esc(doc.title)}</h1>${cover}`;
  if ($('optPlace').checked && s.apt) h += `<div class="pv-place"><span>📍</span><div><b>${esc(s.apt)}</b><small>네이버 장소 카드</small></div></div>`;
  h += `<p class="pv-text pv-center pv-gray">${para(doc.greeting)}</p>`;
  if (T.afterGreetingLine) h += '<hr class="pv-line">';
  s.cards.forEach((c, i) => {
    const hd = doc.headings[i];
    if (hd) h += `<div class="pv-head">${esc(T.heading ? hd : KK.lemonHeadingText(hd))}</div>`;
    h += c.img ? `<img class="pv-img" src="${c.img}" alt="">` : `<div class="pv-empty">사진 ${i + 1}</div>`;
    h += c.text.trim() ? `<p class="pv-text pv-center">${para(c.text)}</p>` : '<p class="pv-text pv-center pv-todo">(설명 글을 써 주세요)</p>';
  });
  const ft = T.footerText || [];
  h += ft.length ? `<p class="pv-divider">◆ ◆ ◆</p><p class="pv-footer">${para(ft.join('\n'))}</p>` : '<p class="pv-divider">◦ ◦ ◦ ◦ ◦</p>';
  h += KK.videoFile ? `<div class="pv-video">▶ ${esc(KK.videoFile.name)}<br><small>제목: ${esc(($('videoTitle').value || '').trim() || doc.videoTitle)}</small></div>` : '<div class="pv-video">▶ 동영상 없음</div>';
  h += `<div class="pv-tags">${doc.tags.map(t => `<span>#${esc(t)}</span>`).join('')}</div>`;
  return h;
};

KK.lemonPlainText = (s, doc) => [
  doc.title, '', '[대표사진]', '', doc.greeting, '',
  ...s.cards.flatMap((c, i) => [(doc.headings[i] ? '[' + doc.headings[i] + ']' : ''), '[사진 ' + (i + 1) + ']', c.text, '']),
  '• • • • •', '', doc.footer, '', '[동영상]', '', doc.tags.map(t => '#' + t).join('')
].join('\n');

/* ───────── Claude 요청문 ───────── */
KK.buildLemonPrompt = only => {
  const s = KK.state, doc = KK.compose(s), kw = doc.kw, V = varsOf(s);
  const target = only != null ? [s.cards[only]] : s.cards, off = only != null ? only : 0;
  const samples = String(P.samples || '').split(/^\s*={3,}\s*$/m).map(x => x.trim()).filter(Boolean).slice(0, 3).map(x => x.slice(0, 3500));
  const titleHint = fillV(P.titlePattern || '', V).replace(/\{subtitle\}/g, '부제') || '지역 인테리어 추천 | 아파트명, 부제';
  const info = (c, i) => `[${i + 1}] ${c.spaceName || '공간'}${c.spaceCont ? '(앞 카드와 같은 공간의 이어지는 사진 — 공간 소개를 되풀이하지 말고 다른 가구·디테일을 씁니다)' : ''} · 사진 ${c.photoIds.length}장${c.photoIds.length > 1 ? '(콜라주)' : ''}` + (c.hint ? ` · 꼭 넣을 내용: ${c.hint}` : '');
  const ln = (P.lines || '3~4').trim() || '3~4';
  return `당신은 인테리어 업체 '레몬하우스'의 네이버 블로그 담당자입니다. 첨부한 사진을 직접 보고, 아래 [내 블로그 글 예시]와 같은 말투·글 틀·분량으로 공간별 설명 문단을 써 주세요.

[글 정보]
- 아파트: ${V.apt || '미입력'} / 지역: ${V.region || '미입력'}
- 키워드: ${[kw.A, kw.B, V.region && V.region + ' 인테리어'].filter(Boolean).map(x => '"' + x + '"').join(', ') || '-'}
${s.must ? '- 이번 글에 꼭 넣을 내용: ' + s.must + '\n' : ''}${P.tone ? '- 말투 메모: ' + P.tone + '\n' : ''}${KK.siteContext ? KK.siteContext(s) : ''}
[사진 순서] 사진 파일 이름의 앞 번호가 문단 번호입니다 (01.jpg → [1], 02-1.jpg·02-2.jpg → [2] 콜라주). 사진을 한 장씩 직접 보고, 보이는 색감·소재·구성을 근거로 쓰세요.
${target.map((c, i) => info(c, off + i)).join('\n')}

[작성 규칙]
1. 문단마다 ${ln}줄로 씁니다. 한 줄은 예시 글의 줄 길이처럼 짧게 끊고, 줄바꿈으로 나눕니다. 한 줄에 한 문장씩 쓰고, 한 문장은 ${KK.lineOpt ? KK.lineOpt().max : 50}자 안쪽으로 끝냅니다. 문장 중간에서는 절대 줄을 바꾸지 않습니다(줄바꿈은 문장이 끝난 뒤에만).
2. 말투·어미·이모지 쓰는 정도는 [예시]를 그대로 따릅니다. 예시에 없는 이모지는 쓰지 않습니다.
3. 사진에서 실제로 보이는 것만 씁니다. 보이지 않는 소재·기능을 지어내지 않습니다.
4. 이 글은 "${V.apt || '해당 아파트'}에 어울리는 인테리어를 소개하고 추천하는 글"입니다. 예시 글의 관점(추천)을 그대로 유지하고, "우리가 이 아파트를 시공했다"처럼 단정하는 표현은 쓰지 않습니다.
5. 위 키워드를 문단 속에 자연스럽게 넣습니다. 첫 문단과 마지막 문단에는 꼭 넣고, 문장 맨 앞에 기계적으로 붙이지 않습니다.
6. 공간 이름(소제목), 인사말, 마무리 문단, 전화번호, 해시태그는 쓰지 않습니다 (프로그램이 따로 넣습니다).
7. 문단끼리 같은 표현·같은 문장 틀을 반복하지 말고, 공간마다 다른 디테일을 다룹니다.
${only != null ? '8. 이번에는 [' + (only + 1) + ']번 문단 하나만 새로 써 주세요.' : '8. 제목도 하나 써 주세요. 형식: "' + titleHint + '" (부제는 이 글의 분위기를 한 구절로)'}
${samples.length ? '' : '9. 예시가 없으니 부드러운 존댓말로, 문단당 ' + ln + '줄로 씁니다.\n'}
${samples.length ? `[내 블로그 글 예시 — 말투·줄 길이·분량 참고용입니다. 내용을 베끼지 말고, 지금 사진에 보이는 것만 쓰세요]\n${samples.map((x, i) => '(예시 ' + (i + 1) + ')\n' + x).join('\n\n')}\n` : ''}
${KK.refPrompt ? KK.refPrompt('write') : ''}
[출력 형식 — 이 형식 그대로, 다른 말 없이]
${only != null ? `[${only + 1}]\n첫 줄\n이어지는 줄들` : '[제목] 제목\n[1]\n첫 줄\n이어지는 줄들\n[2]\n...'}`;
};

/* ───────── 프로필 불러오기·저장 ───────── */
const api = async (url, body) => {
  const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const j = await r.json().catch(() => ({ ok: false, error: '서버 응답을 읽지 못했어요.' }));
  if (!j.ok) throw Error(j.error || '요청 실패');
  return j;
};
function setStatus(id, m, k) { const el = $(id); if (!el) return; el.hidden = !m; el.textContent = m || ''; el.className = 'status ' + (k || ''); }
const blogName = () => { const b = (KK._lemonBlogs || []).find(x => x.key === curBlog); return b ? (b.key === '메인' ? '메인' : b.key + '번') + ' · ' + b.id : ''; };

const FORM = { titlePattern: 'lpTitle', subtitles: 'lpSubs', greeting: 'lpGreet', spaces: 'lpSpaces', headingMode: 'lpHeadMode', headingWrap: 'lpHeadWrap', emphMode: 'lpEmph', extraTags: 'lpTags', videoSuffix: 'lpVideoSuf', closing: 'lpClosing', phone: 'lpPhone', phoneColor: 'lpPhoneColor', lines: 'lpLines', samples: 'lpSamples', tone: 'lpTone' };
function toForm() { for (const [k, id] of Object.entries(FORM)) { const el = $(id); if (el) el.value = P[k] == null ? '' : P[k]; } renderInfo(); }
function fromForm() { for (const [k, id] of Object.entries(FORM)) { const el = $(id); if (el) P[k] = el.value; } }
function renderInfo() {
  const i = P.tplInfo, pill = $('lpPill');
  const name = blogName();
  pill.textContent = !curBlog ? '블로그를 골라 주세요' : P.template ? name + ' · 서식 저장됨' : name + ' · 서식 없음';
  pill.className = 'pill ' + (curBlog && P.template ? 'ok' : '');
  $('lpTplInfo').innerHTML = i ? `가져온 서식: 공간 ${i.sections}곳 · 소제목 ${i.headings ? '모양 ✓' : '없음'} · 인사말 아래 구분선 ${i.line ? '✓' : '없음'} · 마무리 블록 ${i.footer}개 · 강조 서식 ${i.em ? '✓' : '없음'}<br><small>출처 글: ${esc(i.title || '')}</small>` : '아직 가져온 서식이 없어요. 위 ①을 하면 소제목 모양·색·정렬이 그대로 저장돼요. (안 해도 아래 글 틀대로 기본 서식으로 들어가요)';
}
function refresh() { if (isLemon() && KK.changed) KK.changed('fields'); }
function scheduleSave() {
  dirtySave = true; clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveNow(true), 1200);
}
async function saveNow(auto) {
  clearTimeout(saveTimer); if (!dirtySave && auto) return;
  fromForm();
  try {
    await api('/api/lemon/profile', { blog: profKey(), profile: P });
    dirtySave = false;
    setStatus('lpStatus', '✓ 저장했어요' + (curBlog ? ' (' + blogName() + ')' : ' (블로그를 고르면 그 번호로 따로 저장돼요)'), 'ok');
    if (curBlog) KK.lemonTplFlags && (KK.lemonTplFlags[curBlog] = !!P.template);
  } catch (e) { setStatus('lpStatus', '저장하지 못했어요: ' + e.message, 'error'); }
}
function adopt(src, preset) {
  const base = Object.assign(DEFAULTS(), preset || {});
  P = Object.assign(base, src || {});
  KK.lemonProfile = P;
}
async function loadFor(blog) {
  if (loaded && blog === curBlog) return;
  if (dirtySave) await saveNow(true);
  curBlog = blog || ''; loaded = true;
  try {
    const j = await api('/api/lemon/profile?blog=' + encodeURIComponent(profKey()));
    adopt(j.profile, j.preset);
    if (!j.profile && curBlog) { try { const d = await api('/api/lemon/profile?blog=default'); if (d.profile) adopt(Object.assign({}, d.profile, { template: null, tplInfo: null }), j.preset); } catch (_) {} }
  } catch (_) { adopt(null, null); }
  toForm(); refresh();
  const box = $('lemonProfile'); if (box && isLemon() && !P.template && !box.dataset.touched) box.open = true;
}

/* 내 글에서 서식 가져오기 */
async function capture() {
  const b = $('lpCapture'); b.disabled = true; setStatus('lpCapStatus', '네이버 편집 화면을 읽는 중이에요…');
  try {
    if (!await KK.checkExtension()) throw Error('크롬 확장 프로그램이 연결되지 않았어요. 사용방법의 설치 순서를 확인해 주세요.');
    const r = await KK.ext('CAPTURE_TEMPLATE', {}, 20000);
    if (!r.ok) throw Error(r.error || '읽지 못했어요.');
    const c = KK.lemonParseCapture(r.template);
    if (!c.ok) throw Error(c.error);
    fromForm();
    P.template = c.template; P.tplInfo = c.info;
    if (c.titlePattern) P.titlePattern = c.titlePattern;
    if (c.greeting) P.greeting = c.greeting;
    if (c.spaces.length) P.spaces = c.spaces.join(', ');
    if (c.sample && !P.samples.includes(c.sample)) P.samples = P.samples.trim() ? P.samples.trim() + '\n=====\n' + c.sample : c.sample;
    if (c.template.footerText.length) { P.closing = ''; P.phone = ''; }
    toForm(); await saveNow(false); refresh();
    setStatus('lpCapStatus', `✓ 「${c.info.title.slice(0, 30)}」에서 가져왔어요. 공간 ${c.info.sections}곳 · 소제목 ${c.info.headings ? '모양 ✓' : '없음(글자로 넣어요)'} · 마무리 ${c.info.footer}개.\n제목 형식·인사말·공간 이름을 아래에서 확인하고, 아파트 이름이 남아 있으면 {apt}로 바꿔 주세요.` + (c.info.skippedFooter ? `\n※ 마무리 부분의 사진 ${c.info.skippedFooter}개는 서식에 넣지 않았어요.` : ''), 'ok');
  } catch (e) { setStatus('lpCapStatus', e.message, 'error'); }
  finally { b.disabled = false; }
}

function initPanel() {
  if (!$('lemonProfile')) return;
  $('lemonProfile').querySelector('summary').addEventListener('click', () => { $('lemonProfile').dataset.touched = '1'; });
  for (const id of Object.values(FORM)) {
    const el = $(id); if (!el) continue;
    el.addEventListener('input', () => { fromForm(); renderInfo(); scheduleSave(); if (el.type !== 'color') { clearTimeout(initPanel.t); initPanel.t = setTimeout(refresh, 250); } });
  }
  $('lpCapture').addEventListener('click', capture);
  $('lpSave').addEventListener('click', () => { dirtySave = true; saveNow(false); });
  $('lpExport').addEventListener('click', () => {
    fromForm(); KK.download('레몬하우스_글서식_' + (curBlog || '기본') + '.json', JSON.stringify({ kind: 'lemon-profile', blog: curBlog, profile: P }, null, 1), 'application/json');
  });
  $('lpImport').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const j = JSON.parse(await f.text()); if (j.kind !== 'lemon-profile' || !j.profile) throw Error('레몬하우스 글서식 파일이 아니에요.');
      adopt(j.profile, null); toForm(); refresh(); dirtySave = true; await saveNow(false);
      setStatus('lpStatus', '✓ 불러와서 저장했어요 (' + f.name + ')' + (j.blog && j.blog !== curBlog ? '\n※ 다른 블로그(' + j.blog + ')의 서식이에요. 인사말·마무리의 이름과 번호를 확인해 주세요.' : ''), 'ok');
    } catch (err) { setStatus('lpStatus', err.message, 'error'); }
  });
  $('lpReset').addEventListener('click', async () => {
    if (!confirm('이 블로그의 문체·서식을 처음 상태로 되돌릴까요? (저장된 서식과 문체 예시가 지워져요)')) return;
    adopt(null, null); toForm(); dirtySave = true; await saveNow(false); refresh(); setStatus('lpCapStatus', '');
  });

}
document.addEventListener('DOMContentLoaded', () => { initPanel(); toForm(); });
window.addEventListener('beforeunload', () => { if (dirtySave) { try { fromForm(); navigator.sendBeacon('/api/lemon/profile', new Blob([JSON.stringify({ blog: profKey(), profile: P })], { type: 'application/json' })); } catch (_) {} } });

document.addEventListener('kk-lemon-blog', e => { KK._lemonBlogs = e.detail.blogs || KK._lemonBlogs; loadFor(e.detail.blog || ''); });

KK._lemonProfileTest = { get P() { return P; }, set P(v) { P = v; KK.lemonProfile = v; }, templateOf, guessTitle };
})();
