/* 화면 연결 · 상태 저장 · 블로그 미리보기 */
(() => {
'use strict';
const KK = window.KK;
const { $, esc } = KK;
const SAVE_KEY = 'kk2-draft';

const DEFAULT = () => ({ apt: '', region: '', items: ['kitchen'], tone: 'darkwood', specs: '', intro: '', title: '', must: '', ref: '', titlePick: 0, kwA: '', kwB: '', seed: 1, site: null, cards: [], cover: { photoId: '', fit: 'cover', zoom: 100, x: 0, y: 0 } });

/* 아파트명을 적으면 네이버 지도에서 지역을 찾아 자동으로 채웁니다 */
function initRegion() {
  const apt = $('apt'), region = $('region'), hint = $('regionHint'), box = $('regionPick');
  let timer = 0, lastQ = '';
  const show = list => {
    box.innerHTML = list.map(p => `<button type="button" data-region="${KK.esc(p.region)}"><b>${KK.esc(p.region)}</b> <span>${KK.esc(p.name)}</span></button>`).join('');
    box.hidden = !list.length;
  };
  box.addEventListener('click', e => {
    const b = e.target.closest('[data-region]'); if (!b) return;
    region.value = b.dataset.region; S.region = region.value; box.hidden = true; hint.textContent = ''; KK.changed('fields');
  });
  const look = async () => {
    const q = apt.value.trim(); if (q.length < 2 || q === lastQ) return;
    lastQ = q; hint.textContent = '찾는 중…'; box.hidden = true;
    try {
      const j = await (await fetch('/api/place?q=' + encodeURIComponent(q))).json();
      const list = (j.places || []).filter(p => KK.norm(p.name).includes(KK.norm(q)) || KK.norm(q).includes(KK.norm(p.name)));
      const use = list.length ? list : (j.places || []);
      if (!use.length) { hint.textContent = '못 찾았어요 · 직접 적어 주세요'; return; }
      const same = use.filter(p => p.region === use[0].region);
      if (same.length === use.length || use.length === 1) {
        if (!region.value.trim() || region.dataset.auto === '1') { region.value = use[0].region; region.dataset.auto = '1'; S.region = region.value; KK.changed('fields'); }
        hint.textContent = '자동 입력됨 · 다르면 고쳐 주세요';
      } else { hint.textContent = '어느 현장인가요?'; show(use.slice(0, 5)); }
    } catch (_) { hint.textContent = ''; }
  };
  apt.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(look, 700); });
  apt.addEventListener('blur', () => { clearTimeout(timer); look(); });
  region.addEventListener('input', () => { region.dataset.auto = ''; box.hidden = true; hint.textContent = ''; });
}


/* 설정 서랍 (처음 한 번 쓰는 것들 · 문제 생겼을 때 쓰는 것들) */
function initSettings() {
  const box = $('settings');
  // 한 번에 한 구역만 펼쳐져요. 처음엔 아직 안 끝난 구역(검색광고 키 · Claude 연결)을 알아서 펼쳐 둬요.
  let touched = false;
  const accs = () => [...box.querySelectorAll('details.set-acc')];
  box.addEventListener('click', e => { if (e.target.closest('details.set-acc > summary')) touched = true; });
  const pickOpen = () => {
    if (touched) return;
    const need = ['setAccSa', 'setAccAi'].find(id => { const d = $(id); const p = d && d.querySelector('summary .pill'); return p && p.classList.contains('bad'); });
    accs().forEach(d => { d.open = d.id === need; });
  };
  const open = on => {
    box.hidden = !on; document.body.classList.toggle('no-scroll', on);
    if (!on) return;
    touched = false; pickOpen();
    if (KK.checkClaude) KK.checkClaude().then(() => { pickOpen(); setTimeout(pickOpen, 700); });
  };
  $('openSettings').addEventListener('click', () => open(true));
  $('closeSettings').addEventListener('click', () => open(false));
  box.addEventListener('click', e => { if (e.target === box) open(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !box.hidden) open(false); });
  KK.openSettings = () => open(true);
}

/* 오른쪽 칸: 제목 / 미리보기 탭 */
function initTabs() {
  const head = document.querySelector('#titlePanel .tabs');
  head.addEventListener('click', e => {
    const b = e.target.closest('[data-tab]'); if (!b) return;
    head.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('on', x === b));
    const preview = b.dataset.tab === 'preview';
    $('previewPane').hidden = !preview;
    $('titleOptions').hidden = preview;
    $('title').closest('.field').hidden = preview;
    if (preview) KK.renderPreview();
  });
}

const FIELDS = ['apt', 'region', 'specs', 'intro', 'title', 'must', 'ref'];

KK.state = Object.assign(DEFAULT(), KK.store.get(SAVE_KEY, {}), { cards: [], cover: DEFAULT().cover });
const S = KK.state;
const persist = () => { const { cards, cover, ...rest } = S; KK.store.set(SAVE_KEY, rest); };
KK.persist = persist;

/* ── 변경 알림: 무엇이 바뀌었는지에 따라 필요한 부분만 다시 그립니다 ── */
let previewTimer = 0;
KK.changed = kind => {
  if (kind !== 'typing') { KK.compose(S); KK.renderCards(); }
  if (kind === 'cover') KK.renderCover().then(() => KK.renderPreview());
  if (kind === 'keywords' || kind === 'fields' || kind === 'structure') KK.renderKeywords();
  renderFields();
  clearTimeout(previewTimer); previewTimer = setTimeout(KK.renderPreview, kind === 'typing' ? 250 : 0);
  persist();
  if (KK.stepper) KK.stepper.refresh('blog');
};

function renderFields() {
  const doc = KK.compose(S);
  // 제목 후보
  const pick = (S.titlePick ?? 0) % doc.titles.length;
  $('titleOptions').innerHTML = doc.titles.map((t, i) => `<label class="title-opt"><input type="radio" name="titlePick" value="${i}" ${!S.title && i === pick ? 'checked' : ''}> ${doc.titleKinds && doc.titleKinds[i] ? `<small class="muted">[${esc(doc.titleKinds[i])}]</small> ` : ''}${esc(t)}</label>`).join('');
  // 키워드 표시 + 사용 횟수
  const kw = KK.keywords(S);
  $('kwA').textContent = kw.A || '-'; $('kwB').textContent = kw.B || '-';
  $('kwAudit').innerHTML = KK.audit(S, doc).map(a => `<span class="count ${a.count >= 2 ? 'good' : 'short'}">${a.key} · ${esc(a.word)} → 본문 ${a.count}회</span>`).join('') + '<span class="muted"> (목표 각 2회 이상 · 제목·태그 제외)</span>';
  $('intro').placeholder = (KK.TONES[S.tone] || KK.TONES.darkwood).intro + ' (자동)';
  $('tagsPreview').textContent = doc.tags.map(t => '#' + t).join('');
  if (KK.renderCheck) KK.renderCheck(S, doc);
  $('videoTitle').placeholder = doc.title; $('videoTags').placeholder = doc.tags.slice(0, 10).join(', ');
}

/* ── 미리보기: 실제 블로그 배치 그대로 ── */
KK.renderPreview = () => {
  const doc = KK.compose(S), box = $('preview');
  if (doc.lemon && KK.lemonPreviewHtml) { box.innerHTML = KK.lemonPreviewHtml(doc, S); return; }
  const para = t => esc(t).replace(/\n/g, '<br>');
  let h = `<h1 class="pv-title">${esc(doc.title)}</h1>`;
  h += KK.coverData ? `<img class="pv-cover" src="${KK.coverData}" alt="대표사진">` : '<div class="pv-empty">대표사진 1:1</div>';
  h += `<p class="pv-spec">${doc.specLines.map(esc).join('<br>')}</p>`;
  if ($('optPlace').checked && S.apt) h += `<div class="pv-place"><span>📍</span><div><b>${esc(S.apt)}</b><small>네이버 장소 카드</small></div></div>`;
  h += `<p class="pv-text">${para(doc.greeting)}</p><hr class="pv-line">`;
  S.cards.forEach((c, i) => {
    h += c.img ? `<img class="pv-img" src="${c.img}" alt="">` : `<div class="pv-empty">사진 ${i + 1}</div>`;
    h += `<p class="pv-text">${para(c.text)}</p>`;
  });
  if (KK.brandKey === 'lemon') h += `<p class="pv-divider">◦ ◦ ◦ ◦ ◦</p><p class="pv-footer">${para(doc.footer || '')}</p>`;   // 레몬하우스 모드: 키친앤코 안내·링크 카드 없이
  else {
  h += `<p class="pv-divider">◦ ◦ ◦ ◦ ◦</p><p class="pv-footer">오늘 보신 맞춤가구가 마음에 드셨다면<br>키친앤코로 문의주세요!</p><hr class="pv-line"><p class="pv-contact">premium furniture<br>kitchen&amp;ko<br><br><b>• 무료 상담 및 견적 문의</b><br>1833-8504<br><br><b>• 키친앤코 쇼룸 위치</b><br>부산광역시 수영구 수영로 449 2층</p><p class="pv-footer"><b>▼ 홈페이지 견적문의 Click ▼</b></p>`;
  if ($('optLink').checked) h += `<div class="pv-link"><b>키친앤코</b><small>맞춤가구 제작 전문 키친앤코</small><small>kitchennko.com</small></div>`;
  }
  h += KK.videoFile ? `<div class="pv-video">▶ ${esc(KK.videoFile.name)}<br><small>제목: ${esc(($('videoTitle').value || '').trim() || doc.title)}</small></div>` : `<div class="pv-video">▶ 동영상 없음</div>`;
  h += `<div class="pv-tags">${doc.tags.map(t => `<span>#${esc(t)}</span>`).join('')}</div>`;
  box.innerHTML = h;
};

/* ── 입력 칸 ── */
function bindFields() {
  for (const k of FIELDS) {
    const el = $(k); el.value = S[k] || '';
    el.addEventListener('input', () => {
      S[k] = el.value;
      if (k === 'apt') { S.kwA = ''; S.kwB = ''; }
      KK.changed(k === 'title' ? 'typing' : 'fields');
    });
  }
  $('items').innerHTML = KK.ITEMS.map(i => `<button type="button" class="chip ${S.items.includes(i.key) ? 'on' : ''}" data-item="${i.key}">${i.label}</button>`).join('');
  $('items').addEventListener('click', e => {
    const b = e.target.closest('[data-item]'); if (!b) return;
    const k = b.dataset.item;
    S.items = S.items.includes(k) ? S.items.filter(x => x !== k) : [...S.items, k];
    if (!S.items.length) S.items = [k];
    b.parentElement.querySelectorAll('[data-item]').forEach(x => x.classList.toggle('on', S.items.includes(x.dataset.item)));
    S.kwB = '';
    // 품목을 바꾸면 사진 카드의 '내용'도 그 품목 것으로 맞춤
    const groups = [...new Set(S.items.map(k => KK.ITEM_GROUP[k]))];
    for (const c of S.cards) {
      const tp = KK.topicOf(c); if (groups.includes(tp.g)) continue;
      const ng = groups[0]; const nt = KK.TOPICS.find(t => t.g === ng && t.t === tp.t) || KK.TOPICS.find(t => t.g === ng);
      c.topic = nt.key; c.space = nt.space; c.feats = []; c.edited = false; c.topicManual = false; c.topicAi = false;
    }
    KK.autoTopics(S);
    KK.changed('structure');
  });
  $('tones').innerHTML = Object.entries(KK.TONES).map(([k, t]) => `<button type="button" class="chip ${S.tone === k ? 'on' : ''}" data-tone="${k}">${t.label}</button>`).join('');
  $('tones').addEventListener('click', e => {
    const b = e.target.closest('[data-tone]'); if (!b) return;
    S.tone = b.dataset.tone;
    b.parentElement.querySelectorAll('[data-tone]').forEach(x => x.classList.toggle('on', x.dataset.tone === S.tone));
    KK.changed('fields');
  });
  $('titleOptions').addEventListener('change', e => { if (e.target.name === 'titlePick') { S.titlePick = Number(e.target.value); S.title = ''; $('title').value = ''; KK.changed('typing'); renderFields(); } });
  $('shuffle').addEventListener('click', () => { S.seed = (S.seed || 1) + 1; KK.changed('text'); KK.toast('자동 문단을 새 문장으로 바꿨어요. 직접 고친 문단은 그대로예요.'); });
  $('newPost').addEventListener('click', () => {
    if (!confirm('사진과 입력 내용을 모두 비우고 새 글을 시작할까요?')) return;
    Object.assign(S, DEFAULT()); KK.photos.clear(); KK.coverData = '';
    for (const k of FIELDS) $(k).value = '';
    if (KK.refClear) KK.refClear();
    if (KK.siteReset) KK.siteReset();
    if (KK.clearGroupUndo) KK.clearGroupUndo();
    for (const id of ['groupStatus', 'aiStatus']) { const el = $(id); if (el) { el.hidden = true; el.textContent = ''; } }   // 지난 글의 진행 안내가 남아 있지 않게
    bindChipsOnly(); KK.syncCoverInputs(); KK.changed('structure'); KK.renderCover();
    if (KK.stepper) KK.stepper.go('blog', 1, { top: true });
  });
  $('lineBreak').checked = S.lineBreak !== false;
  $('lineBreak').addEventListener('change', () => { S.lineBreak = $('lineBreak').checked; KK.changed('text'); });
  ['optPlace', 'optLink'].forEach(id => $(id).addEventListener('change', () => KK.renderPreview()));
}
function bindChipsOnly() {
  document.querySelectorAll('[data-item]').forEach(x => x.classList.toggle('on', S.items.includes(x.dataset.item)));
  document.querySelectorAll('[data-tone]').forEach(x => x.classList.toggle('on', x.dataset.tone === S.tone));
}

document.addEventListener('DOMContentLoaded', () => {
  if (location.protocol === 'file:') $('fileWarn').hidden = false;
  bindFields(); KK.initPhotos(); KK.initKeywords(); KK.initNaver(); initRegion(); KK.initSite(); initSettings(); initTabs();
  KK.initAi();
  KK.syncCoverInputs();
  KK.changed('structure'); KK.renderCover();
});
})();
