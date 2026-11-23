/* 사진 · 콜라주 · 드래그 정렬 · 대표사진 1:1
   본문은 '카드' 순서대로 올라갑니다. 카드 하나 = 사진 1장 또는 콜라주 1개 + 그 아래 설명 문단 */
(() => {
'use strict';
const KK = window.KK;
const { $, esc } = KK;
const MAX_PHOTOS = 40, MAX_IN_COLLAGE = 6, OUT_W = 1600;
KK.MAX_COLLAGE = MAX_IN_COLLAGE;

KK.photos = new Map();          // id → {id, name, data, w, h}
const S = () => KK.state;

/* ── 사진 읽기 (긴 변 2000px, JPG) ── */
function loadImage(src) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(Error('사진을 열 수 없습니다.')); im.src = src; });
}
async function readFile(f) {
  const url = URL.createObjectURL(f);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
    return { data: c.toDataURL('image/jpeg', .9), w, h, file: f };   // data = 화면용 작은 사본 · file = 올린 원본 (내보낼 때는 원본에서 바로 만들어요 — export.js)
  } finally { URL.revokeObjectURL(url); }
}
/* ── 색톤 · 기울기·원근 (사진마다 p.adj) — 본문 사진·콜라주·대표사진·네이버로 보내는 사진 모두에 그대로 적용돼요 ──
   색톤: ex ct hl sh wh bk tp tn vb sa cl sp (tone.js, -100~100)  /  기하: rot vp hp (geo.js)
   막대를 끄는 동안(opt.live)에는 작은 크기로 빨리 만들고, 손을 떼면 원래 크기로 다시 만들어요 */
const LIVE_MAX = 900;
const adjKey = p => { const a = (p && p.adj) || {}; return KK.toneKey(a) + '|' + KK.geoKey(a); };
const ZERO_KEY = KK.toneKey({}) + '|' + KK.geoKey({});
KK.hasAdj = p => !!p && adjKey(p) !== ZERO_KEY;
const hasToneP = p => KK.hasTone((p && p.adj) || {});
KK.photoData = async (p, opt) => {
  if (!KK.hasAdj(p)) return p.data;
  const live = !!(opt && opt.live), key = adjKey(p), ck = live ? '_liveKey' : '_adjKey', cd = live ? '_liveData' : '_adjData';
  if (p[ck] === key && p[cd]) return p[cd];
  const a = p.adj, img = await loadImage(p.data);
  let w = p.w, h = p.h;
  if (live && Math.max(w, h) > LIVE_MAX) { const sc = LIVE_MAX / Math.max(w, h); w = Math.max(8, Math.round(w * sc)); h = Math.max(8, Math.round(h * sc)); }
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high'; ctx.drawImage(img, 0, 0, w, h);
  let id = ctx.getImageData(0, 0, w, h);
  if (KK.hasTone(a)) KK.toneApply(id.data, w, h, a);
  if (KK.hasGeo(a)) id = new ImageData(KK.geoWarp(id.data, w, h, a), w, h);
  ctx.putImageData(id, 0, 0);
  p[cd] = c.toDataURL('image/jpeg', live ? .8 : .92); p[ck] = key;
  return p[cd];
};
KK.cardKey = (card, live) => card.photoIds.map(id => { const p = KK.photos.get(id); return KK.hasAdj(p) ? id + '~' + adjKey(p) : id; }).join(',') + '|' + card.layout + (live ? '#L' : '');
const fmtAdj = v => (v > 0 ? '+' : '') + v;
// 색톤 막대 묶음 — 라이트룸 기본 패널과 같은 순서 (키, 이름, 막대 색)
const TONE_GROUPS = [
  ['빛', [['ex', '노출'], ['ct', '대비'], ['hl', '밝은 영역'], ['sh', '어두운 영역'], ['wh', '흰색'], ['bk', '검은색']]],
  ['색', [['tp', '색온도', 'temp'], ['tn', '색조', 'tint'], ['vb', '활기'], ['sa', '채도']]],
  ['질감', [['cl', '명료도'], ['sp', '선명하게']]],
];
const TONE_AUTO = { tone: ['ex', 'ct', 'hl', 'sh', 'wh', 'bk'], wb: ['tp', 'tn'] };

/* 끌어다 놓은 파일을 종류별로 나눕니다 — 사진은 사진 카드로, 동영상은 동영상 칸으로 */
const isVideo = f => /^video\//.test(f.type) || /\.(mp4|mov|m4v|avi|wmv|mkv|webm)$/i.test(f.name);
KK.takeFiles = async (files, opt) => {          // opt.bring: 현장에서 사진을 "들고 온" 경우 — 참고 글이 있으면 바로 공간 나누기·콜라주·글쓰기까지 자동 시작
  const all = [...files];
  if (opt && opt.bring && KK.goStep) KK.goStep(2);                 // 다른 탭에서 사진을 들고 오면 [사진 정리] 단계로
  const vids = all.filter(isVideo);
  if (vids.length) {
    KK.setVideo(vids[0]);
    KK.toast(vids.length > 1 ? '동영상은 한 개만 넣을 수 있어 ' + vids[0].name + '만 넣었어요.' : '동영상 ' + vids[0].name + '을(를) 넣었어요.', 'ok');
  }
  const rest = all.filter(f => !isVideo(f));
  if (rest.length) { const n0 = KK.photos.size; await KK.addFiles(rest); if (opt && opt.bring && KK.photos.size > n0 && KK.autoFlowMaybe) KK.autoFlowMaybe('photos'); }
  else if (!vids.length) KK.toast('사진(JPG·PNG)이나 동영상 파일만 넣을 수 있어요.', 'error');
};

KK.addFiles = async files => {
  const list = [...files].filter(f => /^image\/(jpeg|png|webp|heic)?/.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name));
  list.sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true }));
  let added = 0;
  for (const f of list) {
    if (KK.photos.size >= MAX_PHOTOS) { KK.toast('사진은 최대 ' + MAX_PHOTOS + '장까지 올릴 수 있어요.', 'error'); break; }
    try {
      const p = { id: KK.uid('p'), name: f.name, ...(await readFile(f)) };
      KK.photos.set(p.id, p);
      if (autoLevelOn() && KK.photoTilt) { try { await KK.applyAutoLevel(p); } catch (_) {} }
      const first = !S().cards.length;
      S().cards.push(newCard([p.id], first ? null : S().cards.at(-1)?.topic));
      if (!S().cover.photoId) S().cover.photoId = p.id;
      added++;
    } catch (e) { KK.toast(f.name + ': ' + e.message, 'error'); }
  }
  if (added) { KK.autoTopics(S()); KK.changed('structure'); KK.toast('사진 ' + added + '장을 추가했어요. 2장씩 묶으려면 [2장씩 자동 콜라주]를 눌러주세요.', 'ok'); }
};
function newCard(photoIds, topic) {
  const g = KK.ITEM_GROUP[(S().items || [])[0]] || 'kitchen';
  const t = (topic && KK.TOPICS.find(x => x.key === topic)) ? topic : g + '.overview';
  return { id: KK.uid('c'), photoIds, layout: 'auto', topic: t, space: KK.TOPICS.find(x => x.key === t).space, feats: [], text: '', edited: false, img: '', imgKey: '' };
}

/* ── 로고: 사진 아래쪽 가운데에 흰색 로고 (1:1 대표사진은 넣지 않음) ── */
let logoImg = null;
KK.addLogo = async dataUrl => {
  const cb = document.getElementById('optLogo'); if (cb && !cb.checked) return dataUrl;
  if (KK.brandKey === 'lemon' && KK.stampLemon) return KK.stampLemon(dataUrl);   // 레몬하우스 모드: 오른쪽 아래 각인 (lemon.js)
  if (!logoImg) logoImg = await loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(KK.LOGO_SVG));
  const img = await loadImage(dataUrl), W = img.naturalWidth, H = img.naturalHeight;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
  const lw = 0.34 * Math.min(W, H * 0.75), lh = lw * 145 / 509, mb = lw * 0.19;
  ctx.shadowColor = 'rgba(0,0,0,.28)'; ctx.shadowBlur = Math.max(4, lw * 0.015);
  ctx.drawImage(logoImg, (W - lw) / 2, H - mb - lh, lw, lh);
  return c.toDataURL('image/jpeg', .92);
};

/* ── 콜라주 합성: 원본 비율 유지, 자르지 않음 ── */
function layoutRows(card) {
  const n = card.photoIds.length, mode = card.layout === 'auto' ? (n <= 3 ? 'row' : 'grid') : card.layout;
  const ids = card.photoIds;
  if (mode === 'column') return ids.map(id => [id]);
  if (mode === 'row') return [ids];
  const rows = []; for (let i = 0; i < n; i += 2) rows.push(ids.slice(i, i + 2)); return rows;   // grid: 2장씩
}
KK.layoutRows = layoutRows;
KK.cardImage = async (card, opt) => {
  const key = KK.cardKey(card, opt && opt.live);
  if (card.img && card.imgKey === key) return card.img;
  const photos = card.photoIds.map(id => KK.photos.get(id)).filter(Boolean);
  if (!photos.length) return '';
  if (photos.length === 1) { const d = await KK.photoData(photos[0], opt); card.img = d; card.imgKey = key; return d; }
  const gap = 12, rows = layoutRows(card);
  const sized = rows.map(r => {
    const ps = r.map(id => KK.photos.get(id));
    const h = (OUT_W - gap * (ps.length - 1)) / ps.reduce((s, p) => s + p.w / p.h, 0);
    return { ps, h };
  });
  const total = sized.reduce((s, r) => s + r.h, 0) + gap * (sized.length - 1);
  const c = document.createElement('canvas'); c.width = OUT_W; c.height = Math.round(total);
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  let y = 0;
  for (const r of sized) {
    let x = 0;
    for (const p of r.ps) { const w = r.h * p.w / p.h; ctx.drawImage(await loadImage(await KK.photoData(p, opt)), x, y, w, r.h); x += w + gap; }
    y += r.h + gap;
  }
  card.img = c.toDataURL('image/jpeg', .9); card.imgKey = key;
  return card.img;
};

/* ── 카드 조작 ── */
const cardById = id => S().cards.find(c => c.id === id);
function removeEmpty() { S().cards = S().cards.filter(c => c.photoIds.length); }
KK.autoPair = () => {
  const out = [];
  for (const c of S().cards) {
    const prev = out.at(-1);
    if (c.photoIds.length === 1 && prev && prev.photoIds.length === 1 && !prev._paired) {
      prev.photoIds.push(c.photoIds[0]); prev._paired = true; prev.edited = false;
    } else out.push(c);
  }
  out.forEach(c => delete c._paired);
  S().cards = out; KK.autoTopics(S()); KK.changed('structure');
};
KK.mergeSelected = () => {
  const sel = S().cards.filter(c => KK.selected.has(c.id));
  if (sel.length < 2) return KK.toast('묶을 카드를 2개 이상 체크해 주세요.', 'error');
  const ids = sel.flatMap(c => c.photoIds);
  if (ids.length > MAX_IN_COLLAGE) return KK.toast('콜라주는 최대 ' + MAX_IN_COLLAGE + '장까지예요.', 'error');
  sel[0].photoIds = ids; sel[0].edited = false;
  S().cards = S().cards.filter(c => c === sel[0] || !KK.selected.has(c.id));
  KK.selected.clear(); KK.autoTopics(S()); KK.changed('structure');
};
KK.selected = new Set();

/* ── 레몬: 공간별 콜라주 묶기 (계획은 ai.js KK.planGroups) · 되돌리기는 한 번 ── */
let groupUndo = null;
const photoSetOf = cards => new Set(cards.flatMap(c => c.photoIds));
const sameSet = (a, b) => a.size === b.size && [...a].every(x => b.has(x));
KK.groupUndoReady = () => !!groupUndo;
KK.applyGroups = plan => {
  const s = S(), cur = photoSetOf(s.cards);
  if (!sameSet(cur, new Set(plan.flatMap(g => g.pids)))) throw Error('분류하는 동안 사진이 바뀌었어요. 한 번 더 눌러 주세요.');
  const owner = new Map(); s.cards.forEach(c => c.photoIds.forEach(pid => owner.set(pid, c)));
  const before = s.cards.map(c => ({ ...c, photoIds: c.photoIds.slice(), feats: (c.feats || []).slice() }));
  s.cards = plan.map(g => {
    const c = newCard(g.pids.slice(), null);
    c.hint = [...new Set(g.pids.map(pid => String((owner.get(pid) || {}).hint || '').trim()).filter(Boolean))].join(' / ');
    c.spaceName = g.name; c.spaceManual = true; c.spaceCont = !!g.cont;
    if (g.name && g.ai) { c.spaceAi = true; c.aiTopic = g.name; c.aiConf = g.conf; c.aiSeen = g.seen; c.aiNote = g.note; c.aiAlt = ''; c.aiFixId = ''; c.aiTip = [g.seen, g.note].filter(Boolean).join(' — '); }
    return c;
  });
  KK.selected.clear(); groupUndo = { before, photos: cur };
  KK.changed('structure');
  return s.cards.length;
};
KK.undoGroups = () => {
  if (!groupUndo) return { ok: false, msg: '되돌릴 기록이 없어요.' };
  const s = S();
  if (!sameSet(photoSetOf(s.cards), groupUndo.photos)) { groupUndo = null; return { ok: false, msg: '그 사이 사진을 추가·삭제해서 되돌릴 수 없어요.' }; }
  s.cards = groupUndo.before; groupUndo = null; KK.selected.clear(); KK.changed('structure');
  return { ok: true, msg: '묶기 전 상태로 되돌렸어요.' };
};
KK.clearGroupUndo = () => { groupUndo = null; };

function detachPhoto(cardId, photoId) {
  const card = cardById(cardId); if (!card || card.photoIds.length < 2) return;
  card.photoIds = card.photoIds.filter(x => x !== photoId);
  const i = S().cards.indexOf(card);
  S().cards.splice(i + 1, 0, newCard([photoId], card.topic));
  KK.changed('structure');
}
function deletePhoto(cardId, photoId) {
  const card = cardById(cardId); if (!card) return;
  card.photoIds = card.photoIds.filter(x => x !== photoId);
  KK.photos.delete(photoId);
  if (S().cover.photoId === photoId) S().cover.photoId = S().cards.flatMap(c => c.photoIds)[0] || '';
  removeEmpty(); KK.changed('structure');
}

/* ── 렌더링 ── */
const LAYOUTS = [['auto', '자동'], ['row', '가로 나란히'], ['grid', '2열 바둑판'], ['column', '세로로']];
const adjSummary = c => c.photoIds.some(id => hasToneP(KK.photos.get(id))) ? '색·밝기 조절 <b>(조절함)</b>' : '색·밝기 조절 <span class="muted">— 라이트룸처럼 노출·색온도·대비…</span>';
function adjBox(c) {
  const a = (KK.photos.get(c.photoIds[0]) || {}).adj || {};
  const row = ([k, l, g]) => `<label class="adj-row"><span>${l}</span><input type="range" min="-100" max="100" step="1" value="${a[k] || 0}" data-adj="${k}" ${g ? `class="grad-${g}"` : ''} aria-label="${l}"><output>${fmtAdj(a[k] || 0)}</output></label>`;
  return `<details class="adj" ${c.adjOpen ? 'open' : ''}><summary>${adjSummary(c)}</summary>
    <div class="adj-btns"><button type="button" class="tiny" data-act="toneAuto" title="사진마다 밝기 분포를 보고 노출·대비·밝은/어두운 영역·흰색·검은색을 알맞게 맞춰요">자동 톤</button><button type="button" class="tiny" data-act="wbAuto" title="사진의 색 쏠림을 보고 색온도·색조를 조심스럽게 맞춰요">자동 색감</button></div>
    ${TONE_GROUPS.map(([t, rows]) => `<div class="adj-grp">${t}</div>${rows.map(row).join('')}`).join('')}
    <div class="adj-btns"><button type="button" class="tiny" data-act="adjReset">처음대로</button><button type="button" class="tiny" data-act="adjAll" title="이 카드의 색·밝기 값을 모든 사진에 똑같이 적용해요 (기울기·원근은 그대로)">모든 사진에 적용</button></div>
    <p class="help" style="margin:4px 0 0">막대를 움직이면 사진에 바로 적용돼요(막대를 두 번 누르면 0). 막대는 카드 안 사진 모두에 똑같이 적용되고, [자동 톤]·[자동 색감]은 사진마다 따로 계산해요. 색온도는 +가 노랗게(따뜻하게), 색조는 +가 자주 쪽이에요.</p>
  </details>`;
}
/* ── 기울기 · 세로 원근 · 가로 원근 (사진마다 p.adj.rot / vp / hp) ── */
const fmtRot = v => (v > 0 ? '+' : '') + (Math.round(v * 10) / 10).toFixed(1) + '°';
const GEO_ROWS = [['rot', '기울기', -15, 15, 0.1, '사진을 돌려요 (+는 시계 방향)'], ['vp', '세로 원근', -100, 100, 1, '위아래로 모여 보이는 세로선을 곧게 펴요 (+는 위쪽을 넓힘)'], ['hp', '가로 원근', -100, 100, 1, '좌우로 모여 보이는 가로선을 곧게 펴요 (+는 오른쪽을 넓힘)']];
const fmtGeo = (k, v) => k === 'rot' ? fmtRot(v) : fmtAdj(Math.round(v));
const geoPidOf = c => c.photoIds.includes(c.geoPid) ? c.geoPid : c.photoIds[0];
const gridNOf = c => c.gridN != null ? c.gridN : (c.gridOn ? 8 : 0);
const geoSummary = c => c.photoIds.some(id => KK.hasGeo((KK.photos.get(id) || {}).adj)) ? '수평·수직 맞추기 <b>(조절함)</b>' : '수평·수직 맞추기 <span class="muted">— 기울기·원근, 선으로 맞추는 도우미</span>';
function levelBox(c) {
  const pid = geoPidOf(c), p = KK.photos.get(pid), a = (p && p.adj) || {}, gn = gridNOf(c);
  const picks = c.photoIds.length > 1 ? `<div class="lv-pick">${c.photoIds.map((id, k) => { const q = KK.photos.get(id); return q ? `<button type="button" class="lv-pk ${id === pid ? 'on' : ''}" data-geopick="${id}" title="사진 ${k + 1} 맞추기"><img class="lv-th" src="${q.data}" alt="사진 ${k + 1}">${KK.hasGeo(q.adj) ? '<i title="맞춘 사진"></i>' : ''}</button>` : ''; }).join('')}</div>` : '';
  const rows = GEO_ROWS.map(([k, l, mn, mx, st, tip]) => `<div class="lv-row"><span title="${tip}">${l}</span><input type="range" min="${mn}" max="${mx}" step="${st}" value="${a[k] || 0}" data-geo="${k}" aria-label="${l}" title="${tip}"><output>${fmtGeo(k, a[k] || 0)}</output><button type="button" class="tiny" data-act="geoAuto" data-axis="${k}" title="${l}만 자동으로 찾아 맞춰요">자동</button><button type="button" class="tiny" data-act="geoZero" data-axis="${k}" title="0으로 되돌리기">0</button></div>`).join('');
  return `<details class="lvbox" ${c.levelOpen ? 'open' : ''}><summary>${geoSummary(c)}</summary>
    ${picks}${rows}
    <div class="adj-btns"><button type="button" class="tiny" data-act="geoOne" title="이 사진의 기울기·세로 원근·가로 원근을 자동으로 찾아 맞춰요">이 사진 자동</button><button type="button" class="tiny" data-act="geoHelp" title="사진 위에 가로·세로로 맞출 선을 그으면 알아서 계산해요">선으로 맞추기 (도우미)</button><button type="button" class="tiny" data-act="levelCard">이 카드 사진 모두 자동</button></div>
    <div class="adj-btns"><label class="mini" style="margin:0;font-size:12px">격자 <select data-act="gridN">${[[0, '없음'], [4, '큼직하게'], [8, '보통'], [16, '촘촘하게']].map(([v, l]) => `<option value="${v}" ${v === gn ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
    <p class="help" style="margin:4px 0 0">사진을 골라 막대로 맞춰요(막대를 두 번 누르면 0). 돌리거나 원근을 펴면 가장자리가 조금 잘려요. [자동]은 가구 모서리·문틀·선반 같은 가로·세로 직선을 찾아 맞추고, 직선이 적으면 건드리지 않아요. 자동이 어긋나면 [선으로 맞추기]로 기준이 될 선을 직접 그어 주세요.</p>
  </details>`;
}
const clampGeo = (k, v) => { const m = KK.GEO_RANGE[k]; return Math.max(-m, Math.min(m, Math.round(v * (k === 'rot' ? 10 : 2)) / (k === 'rot' ? 10 : 2))); };
const setGeo = (p, k, v) => { p.adj = p.adj || {}; p.adj[k] = clampGeo(k, v); };
const setRot = (p, v) => setGeo(p, 'rot', v);
function syncLevel(card) {            // 한 번에 바뀐 값(자동·0·선 고르기)을 화면에 다시 그려요 — 막대를 끄는 중에는 쓰지 않아요
  const el = document.querySelector(`[data-card="${card.id}"]`); if (!el) return;
  const old = el.querySelector('details.lvbox'); if (!old) return;
  const t = document.createElement('div'); t.innerHTML = levelBox(card).trim(); old.replaceWith(t.firstElementChild);
}
/* 사진 한 장 자동 맞춤(기울기만) → 'fixed'(돌림) | 'straight'(이미 반듯) | 'unsure'(직선이 적어 모르겠음, 그대로 둠) — 올릴 때 자동 수평에서 써요 */
KK.applyAutoLevel = async p => {
  const t = await KK.photoTilt(p);
  if (!t.ok) return 'unsure';
  if (Math.abs(t.rot) < 0.3) { setRot(p, 0); return 'straight'; }
  setRot(p, t.rot); return 'fixed';
};
/* 기울기·세로 원근·가로 원근 자동 (axes 로 일부만 고를 수 있어요) → { rot, vp, hp } 각각 'fixed' | 'straight' | 'unsure' */
KK.applyAutoGeo = async (p, axes = ['rot', 'vp', 'hp']) => {
  const g = await KK.photoGeo(p, axes.includes('rot') ? undefined : ((p.adj || {}).rot || 0)), out = {};
  if (axes.includes('rot')) { if (!g.okRot) out.rot = 'unsure'; else if (Math.abs(g.rot) < 0.3) { setRot(p, 0); out.rot = 'straight'; } else { setRot(p, g.rot); out.rot = 'fixed'; } }
  for (const [k, ok, zero] of [['vp', g.okV, g.zeroV], ['hp', g.okH, g.zeroH]]) {
    if (!axes.includes(k)) continue;
    const v = g[k];
    if (!ok) out[k] = 'unsure';
    else if (zero || Math.abs(v) < 5) { setGeo(p, k, 0); out[k] = 'straight'; }
    else if (Math.abs(v) > 70) out[k] = 'unsure';       // 너무 크게 나오면 잘못 읽었을 가능성이 커서 건드리지 않아요
    else { setGeo(p, k, v); out[k] = 'fixed'; }
  }
  return out;
};
const geoMsg = list => {
  const n = k => list.filter(r => r[k] === 'fixed').length, parts = [];
  if (n('rot')) parts.push('기울기 ' + n('rot') + '장'); if (n('vp')) parts.push('세로 원근 ' + n('vp') + '장'); if (n('hp')) parts.push('가로 원근 ' + n('hp') + '장');
  const none = list.filter(r => !Object.values(r).includes('fixed')).length;
  return parts.length ? parts.join(' · ') + ' 보정' + (none ? ' · ' + none + '장은 그대로(이미 반듯하거나 직선이 적음)' : '') : '바꾼 사진이 없어요 — 이미 반듯하거나 직선이 적어요';
};
const yieldUi = () => new Promise(r => setTimeout(r));
KK.autoLevelAll = async () => {
  const ids = [...new Set(S().cards.flatMap(c => c.photoIds))], btn = $('autoLevelAll');
  if (!ids.length) return KK.toast('사진을 먼저 올려 주세요.', 'error');
  const list = []; btn.disabled = true; const label0 = btn.textContent;
  try {
    for (let i = 0; i < ids.length; i++) {
      btn.textContent = '맞추는 중 ' + (i + 1) + '/' + ids.length;
      const p = KK.photos.get(ids[i]); if (!p) continue;
      try { list.push(await KK.applyAutoGeo(p)); } catch (_) { list.push({ rot: 'unsure' }); }
      await yieldUi();
    }
    KK.changed('structure'); await KK.renderCover(); KK.renderPreview();
    KK.toast('수평·수직 자동 맞춤 — ' + geoMsg(list) + '. 카드의 [수평·수직 맞추기]에서 사진마다 고칠 수 있어요.', 'ok');
  } finally { btn.disabled = false; btn.textContent = label0; }
};
const autoLevelOn = () => { try { return localStorage.getItem('kk-auto-level') === '1'; } catch (_) { return false; } };

/* ── 자동 색톤 ── 원본 사진의 밝기 분포·색 쏠림을 보고 막대 값을 정해요 (몇 번을 눌러도 같은 값) */
async function photoPixels(p, max) {
  const im = await loadImage(p.data), sc = Math.min(1, max / Math.max(p.w, p.h)), w = Math.max(8, Math.round(p.w * sc)), h = Math.max(8, Math.round(p.h * sc));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(im, 0, 0, w, h);
  return { d: ctx.getImageData(0, 0, w, h).data, w, h };
}
KK.applyAutoTone = async (p, kinds = ['tone', 'wb']) => {
  const { d, w, h } = await photoPixels(p, 480);
  const r = KK.autoToneAdj(d, w, h, { tone: kinds.includes('tone'), wb: kinds.includes('wb') });
  p.adj = p.adj || {};
  for (const kind of kinds) for (const k of TONE_AUTO[kind]) p.adj[k] = r[k] || 0;
  return r;
};
KK.autoToneAll = async () => {
  const ids = [...new Set(S().cards.flatMap(c => c.photoIds))], btn = $('autoToneAll');
  if (!ids.length) return KK.toast('사진을 먼저 올려 주세요.', 'error');
  btn.disabled = true; const label0 = btn.textContent; let changed = 0;
  try {
    for (let i = 0; i < ids.length; i++) {
      btn.textContent = '색톤 맞추는 중 ' + (i + 1) + '/' + ids.length;
      const p = KK.photos.get(ids[i]); if (!p) continue;
      try { const before = KK.toneKey(p.adj); await KK.applyAutoTone(p); if (KK.toneKey(p.adj) !== before) changed++; } catch (_) {}
      await yieldUi();
    }
    KK.changed('structure'); await KK.renderCover(); KK.renderPreview();
    KK.toast('색톤 자동 맞춤 — ' + changed + '장 조절 (나머지는 이미 알맞아 그대로). 카드의 [색·밝기 조절]에서 사진마다 고칠 수 있어요.', 'ok');
  } finally { btn.disabled = false; btn.textContent = label0; }
};
// 막대를 끄는 동안 사진을 다시 만드는 일은 한 번에 하나씩, 마지막 값 기준으로만 해요 (끄는 중엔 작은 크기로 빨리, 손을 떼면 원래 크기로)
const adjBusy = new Map(), adjLive = new Map();
async function refreshAdj(card, live) {
  adjLive.set(card.id, !!live);
  if (adjBusy.get(card.id)) { adjBusy.set(card.id, 2); return; }
  try { do { adjBusy.set(card.id, 1); await KK.cardImage(card, adjLive.get(card.id) ? { live: true } : undefined); } while (adjBusy.get(card.id) === 2); } finally { adjBusy.delete(card.id); }
  const cardEl = document.querySelector(`[data-card="${card.id}"]`);
  if (cardEl) {
    const el = cardEl.querySelector('.preview-img'); if (el) el.innerHTML = `<img src="${card.img}" alt="" draggable="false">`;
    const sm = cardEl.querySelector('details.adj > summary'); if (sm) sm.innerHTML = adjSummary(card);
    const sg = cardEl.querySelector('details.lvbox > summary'); if (sg) sg.innerHTML = geoSummary(card);
  }
  if (adjLive.get(card.id)) return;
  if (card.photoIds.includes(S().cover.photoId)) await KK.renderCover();
  KK.renderPreview();
}
// 막대를 끄는 동안(live)은 작게 빨리 → 멈추면(0.45초) 또는 손을 떼면 원래 크기로 한 번 더
const adjFinal = card => { clearTimeout(card._fin); card._fin = null; return refreshAdj(card, false); };
const adjLiveGo = card => { refreshAdj(card, true); clearTimeout(card._fin); card._fin = setTimeout(() => { card._fin = null; refreshAdj(card, false); }, 450); };
const setAdj = (card, k, v) => card.photoIds.forEach(id => { const p = KK.photos.get(id); if (p) { p.adj = p.adj || {}; p.adj[k] = v; } });
// 격자: 평소엔 카드 설정대로, 기울기·원근 막대를 끄는 동안엔 잠깐 보여줘서 맞추기 쉽게 해요
const setGrid = (card, dragging) => {
  const pv = document.querySelector(`[data-card="${card.id}"] .preview-img`); if (!pv) return;
  const n = gridNOf(card) || (dragging ? 8 : 0);
  pv.classList.toggle('grid', !!n); if (n) pv.style.setProperty('--g', 100 / n + '%'); else pv.style.removeProperty('--g');
};
const syncAdjInputs = card => {
  const el = document.querySelector(`[data-card="${card.id}"]`), a = (KK.photos.get(card.photoIds[0]) || {}).adj || {}; if (!el) return;
  el.querySelectorAll('[data-adj]').forEach(i => { const v = a[i.dataset.adj] || 0; i.value = v; i.nextElementSibling.textContent = fmtAdj(v); });
  const sm = el.querySelector('details.adj > summary'); if (sm) sm.innerHTML = adjSummary(card);
};

const aiTag = c => `<small class="ai-tag ${c.aiConf === 'low' ? 'low' : ''}" title="${esc(c.aiTip || c.aiNote || '')}">Claude가 정함${c.aiConf === 'low' ? ' · 확인 필요' : ''}</small>`;
KK.renderCards = () => {
  const box = $('cards'), s = S();
  $('photoCount').textContent = KK.photos.size + '장 · 본문 사진 ' + s.cards.length + '개';
  $('cardTools').hidden = !s.cards.length;
  KK.renderStrip();
  if (!s.cards.length) { box.innerHTML = ''; return; }
  const lemon = KK.brandKey === 'lemon';
  const spaceList = lemon ? String((KK.lemonProfile && KK.lemonProfile.spaces) || '').split(/[,\n]/).map(x => x.trim()).filter(Boolean) : [];
  box.innerHTML = (lemon ? `<datalist id="lspaceList">${spaceList.map(n => `<option value="${esc(n)}">`).join('')}</datalist>` : '') + s.cards.map((c, i) => {
    const tp = KK.topicOf(c);
    const groups = [...new Set(KK.TOPICS.map(t => t.g))];
    const spaceOpts = groups.map(g => `<optgroup label="${KK.GROUP_LABEL[g]}">${KK.TOPICS.filter(t => t.g === g).map(t => `<option value="${t.key}" ${t.key === tp.key ? 'selected' : ''}>${KK.GROUP_LABEL[g]} · ${t.label}</option>`).join('')}</optgroup>`).join('');
    const chips = KK.CHIP_GROUPS.map(gr => {
      const row = Object.entries(gr.chips).filter(([n, d]) => !d.g || d.g.includes(tp.g)).map(([n, d]) => `<button type="button" class="chip ${c.feats.includes(n) || tp.imply.includes(n) ? 'on' : ''} ${tp.imply.includes(n) ? 'implied' : ''}" data-feat="${esc(n)}">${esc(d.label || n)}</button>`).join('');
      return row ? `<div class="chip-row"><span class="chip-label">${gr.label}</span><div class="chips">${row}</div></div>` : '';
    }).join('');
    const nSel = c.feats.length;
    const thumbs = c.photoIds.map(pid => { const p = KK.photos.get(pid); return `<div class="thumb" draggable="true" data-photo="${pid}"><img src="${p.data}" alt=""><div class="thumb-actions">${pid === s.cover.photoId ? '<span class="badge">대표</span>' : `<button type="button" data-act="cover" title="대표사진으로">대표</button>`}${c.photoIds.length > 1 ? '<button type="button" data-act="detach" title="콜라주에서 빼기">분리</button>' : ''}<button type="button" data-act="delete" title="사진 삭제">삭제</button></div></div>`; }).join('');
    return `<article class="card" data-card="${c.id}">
      <div class="card-head" draggable="true" title="끌어서 순서 변경">
        <span class="grip">⠿</span><b>${i + 1}</b>
        <span class="muted">${c.photoIds.length > 1 ? '콜라주 ' + c.photoIds.length + '장' : '사진 1장'}</span>
        <button type="button" class="tiny" data-act="up" ${i === 0 ? 'disabled' : ''} title="위로">↑</button><button type="button" class="tiny" data-act="down" ${i === s.cards.length - 1 ? 'disabled' : ''} title="아래로">↓</button>
        <label class="pick"><input type="checkbox" data-act="select" ${KK.selected.has(c.id) ? 'checked' : ''}> 묶기 선택</label>
      </div>
      <div class="card-body">
        <div class="card-media">
          <div class="preview-img ${gridNOf(c) ? 'grid' : ''}" ${gridNOf(c) ? `style="--g:${100 / gridNOf(c)}%"` : ''} draggable="true" title="다른 사진 위에 끌어다 놓으면 콜라주로 합쳐져요">${c.img ? `<img src="${c.img}" alt="본문 사진 ${i + 1}" draggable="false">` : '<div class="pending">미리보기 만드는 중…</div>'}</div>
          <div class="thumbs" data-drop="${c.id}">${thumbs}</div>
          ${c.photoIds.length > 1 ? `<label class="mini">콜라주 모양 <select data-act="layout">${LAYOUTS.map(([v, l]) => `<option value="${v}" ${v === c.layout ? 'selected' : ''}>${l}</option>`).join('')}</select></label>` : ''}
          ${adjBox(c)}
          ${levelBox(c)}
        </div>
        <div class="card-text">
          ${lemon ? `<label class="mini lp-space"><span>공간 이름${c.spaceAi ? aiTag(c) : ''}${c.spaceCont ? '<small class="ai-tag" title="앞 카드와 같은 공간이라 소제목을 한 번만 넣어요. 소제목을 넣으려면 이름을 직접 고쳐 쓰세요.">앞 카드에 이어짐 · 소제목 없음</small>' : ''}</span><input data-act="lspace" list="lspaceList" value="${esc(c.spaceName || '')}" placeholder="소제목 · 예: 거실 (비우면 소제목 없음)" autocomplete="off"></label>` : `<label class="mini">내용${c.topicAi ? aiTag(c) : ''} <select data-act="space">${spaceOpts}</select></label>
          <details class="refine" ${c.refineOpen ? 'open' : ''} data-act="refine"><summary>키워드로 다듬기 ${nSel ? '<b>(' + nSel + '개 선택)</b>' : '<span class="muted">— 글이 마음에 안 들 때</span>'}</summary>
            <p class="help" style="margin:4px 0 6px">사진에 <b>실제로 보이는 것</b>을 고르면 그 내용이 문단에 꼭 들어가요. 고르지 않은 디테일은 들어가지 않아요.</p>
            ${chips}
          </details>`}
          <input data-act="hint" class="hint" value="${esc(c.hint || '')}" placeholder="${lemon ? '이 사진에 꼭 넣을 내용 (선택)' : '이 사진에 꼭 넣을 내용 (예: 유리장 안 와인 수납, 대리석 상판)'}">
          <textarea data-act="text" rows="5" placeholder="${lemon ? '사진 아래 들어갈 설명 — [Claude로 자동 작성]이나 직접 입력' : '사진 아래 들어갈 설명'}">${esc(c.text)}</textarea>
          <div class="row-between"><span class="muted">${lemon ? (c.text.trim() ? '✎ 작성된 문단' : '비어 있어요 — Claude로 쓰거나 직접 적어 주세요') : (c.edited ? '✎ 직접 수정·AI 작성 문단' : '자동 작성 문단')} · ${c.text.length}자</span><span>${lemon ? '' : '<button type="button" class="tiny" data-act="reroll" title="이 문단만 다른 문장으로">다시 쓰기</button>'}${KK.claudeReady ? '<button type="button" class="tiny" data-act="aiRedo" title="사진을 보고 Claude가 이 문단만 다시 씁니다">Claude로 다시</button>' : ''}<button type="button" class="tiny" data-act="aiCopyOne" title="이 문단만 Claude/ChatGPT에 다시 써 달라고 할 요청문 복사">AI 요청 복사</button></span></div>
        </div>
      </div>
    </article>`;
  }).join('');
  // 콜라주 이미지는 비동기로 채웁니다
  s.cards.forEach(async c => {
    if (c.img && c.imgKey === KK.cardKey(c)) return;
    await KK.cardImage(c);
    const el = box.querySelector(`[data-card="${c.id}"] .preview-img`);
    if (el) el.innerHTML = `<img src="${c.img}" alt="" draggable="false">`;
    KK.renderPreview();
  });
};

/* ── 이벤트 (카드 목록 하나에 위임) ── */
function bindCards() {
  const box = $('cards');
  box.addEventListener('click', e => {
    const cardEl = e.target.closest('[data-card]'); if (!cardEl) return;
    const card = cardById(cardEl.dataset.card); if (!card) return;
    const gp = e.target.closest('[data-geopick]');
    if (gp) { card.geoPid = gp.dataset.geopick; syncLevel(card); return; }
    const feat = e.target.closest('[data-feat]');
    if (feat) {
      if (feat.classList.contains('implied')) { KK.toast('이 내용은 위에서 고른 주제에 이미 들어가 있어요.'); return; }
      const n = feat.dataset.feat;
      card.feats = card.feats.includes(n) ? card.feats.filter(x => x !== n) : [...card.feats, n];
      card.edited = false; KK.changed('text'); return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    const pid = e.target.closest('[data-photo]')?.dataset.photo;
    if (act === 'cover' && pid) { S().cover.photoId = pid; const cp = KK.$('coverPanel'); if (cp) cp.open = true; KK.changed('cover'); }
    if (act === 'detach' && pid) detachPhoto(card.id, pid);
    if (act === 'delete' && pid) deletePhoto(card.id, pid);
    if (act === 'reset') { card.edited = false; KK.changed('text'); }
    if (act === 'adjReset') {
      for (const k of KK.TONE_KEYS) setAdj(card, k, 0);
      syncAdjInputs(card); adjFinal(card);
    }
    if (act === 'toneAuto' || act === 'wbAuto') {
      const b = e.target.closest('button'), t0 = b.textContent; b.disabled = true; b.textContent = '계산 중…';
      (async () => {
        for (const id of card.photoIds) { const p3 = KK.photos.get(id); if (p3) await KK.applyAutoTone(p3, [act === 'toneAuto' ? 'tone' : 'wb']); }
        syncAdjInputs(card); await adjFinal(card);
        KK.toast((act === 'toneAuto' ? '밝기·대비를 사진마다 맞췄어요.' : '색온도·색조를 사진마다 맞췄어요.') + ' 막대는 첫 번째 사진 기준으로 보여요. 마음에 안 들면 [처음대로]나 막대로 고치세요.', 'ok');
      })().catch(err => KK.toast(err.message, 'error')).finally(() => { b.disabled = false; b.textContent = t0; });
      return;
    }
    if (act === 'geoZero') {
      const p2 = KK.photos.get(geoPidOf(card)); if (!p2) return;
      setGeo(p2, e.target.dataset.axis, 0); syncLevel(card); adjFinal(card); return;
    }
    if (act === 'geoAuto' || act === 'geoOne') {
      const p2 = KK.photos.get(geoPidOf(card)); if (!p2) return;
      const axes = act === 'geoOne' ? ['rot', 'vp', 'hp'] : [e.target.dataset.axis], b = e.target.closest('button'), t0 = b.textContent; b.disabled = true; b.textContent = '…';
      KK.applyAutoGeo(p2, axes).then(r => {
        syncLevel(card); adjFinal(card);
        const names = { rot: '기울기', vp: '세로 원근', hp: '가로 원근' };
        const fixed = axes.filter(k => r[k] === 'fixed').map(k => names[k] + ' ' + fmtGeo(k, p2.adj[k])), unsure = axes.filter(k => r[k] === 'unsure').map(k => names[k]);
        KK.toast(fixed.length ? fixed.join(' · ') + '로 맞췄어요.' + (unsure.length ? ' (' + unsure.join('·') + '은 직선이 적어 그대로 뒀어요)' : '') : unsure.length === axes.length ? '가로·세로 직선을 잘 못 찾았어요. 막대나 [선으로 맞추기]로 직접 맞춰 주세요.' : '이미 반듯해서 그대로 뒀어요.', !fixed.length && unsure.length === axes.length ? 'error' : 'ok');
      }).catch(err => KK.toast(err.message, 'error')).finally(() => { b.disabled = false; b.textContent = t0; });
      return;
    }
    if (act === 'geoHelp') {
      const p2 = KK.photos.get(geoPidOf(card)); if (!p2) return;
      KK.openLevelHelper(p2, res => { for (const k of ['rot', 'vp', 'hp']) if (res[k] != null) setGeo(p2, k, res[k]); syncLevel(card); adjFinal(card); KK.toast('선으로 맞췄어요 — ' + GEO_ROWS.filter(r => res[r[0]] != null).map(r => r[1] + ' ' + fmtGeo(r[0], p2.adj[r[0]])).join(' · '), 'ok'); });
      return;
    }
    if (act === 'levelCard') {
      const b = e.target; b.disabled = true; b.textContent = '맞추는 중…';
      (async () => { const list = []; for (const id of card.photoIds) { const p3 = KK.photos.get(id); if (p3) list.push(await KK.applyAutoGeo(p3).catch(() => ({ rot: 'unsure' }))); } syncLevel(card); await adjFinal(card); KK.toast('수평·수직 자동 맞춤 — ' + geoMsg(list), list.every(r => !Object.values(r).includes('fixed')) ? 'error' : 'ok'); })()
        .finally(() => { b.disabled = false; b.textContent = '이 카드 사진 모두 자동'; });
      return;
    }
    if (act === 'adjAll') {
      const a = (KK.photos.get(card.photoIds[0]) || {}).adj || {};
      for (const p of KK.photos.values()) { p.adj = p.adj || {}; for (const k of KK.TONE_KEYS) p.adj[k] = a[k] || 0; }
      KK.changed('structure'); KK.renderCover().then(() => KK.renderPreview());
      KK.toast('이 카드의 색·밝기를 모든 사진(' + KK.photos.size + '장)에 똑같이 적용했어요.', 'ok');
    }
    if (act === 'aiCopyOne') { KK.copy(KK.buildAiPrompt(S().cards.indexOf(card))).then(() => KK.toast('이 문단용 요청문을 복사했어요. 채팅에 이 사진과 함께 붙여넣고, 답을 [Claude로 사진 보고 쓰기] 칸의 붙여넣기 창에 넣고 [적용]을 누르세요.', 'ok')); }
    if (act === 'reroll') { card.salt = (card.salt || 0) + 1; card.edited = false; KK.changed('text'); }
    if (act === 'aiRedo') {
      const b = e.target; b.disabled = true; b.textContent = '작성 중…';
      KK.aiWrite(S().cards.indexOf(card)).then(() => { KK.changed('typing'); KK.renderCards(); }).catch(err => { KK.toast(err.message, 'error'); b.disabled = false; b.textContent = 'AI로 다시'; });
    }
    if (act === 'up' || act === 'down') {
      const cards = S().cards, i = cards.indexOf(card), j = act === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= cards.length) return;
      [cards[i], cards[j]] = [cards[j], cards[i]]; KK.changed('structure');
    }
  });
  box.addEventListener('toggle', e => {
    const card = cardById(e.target.closest('[data-card]')?.dataset.card); if (!card) return;
    if (e.target.matches('details.refine')) card.refineOpen = e.target.open;
    if (e.target.matches('details.adj')) card.adjOpen = e.target.open;
    if (e.target.matches('details.lvbox')) card.levelOpen = e.target.open;
  }, true);
  box.addEventListener('change', e => {
    const card = cardById(e.target.closest('[data-card]')?.dataset.card); if (!card) return;
    if (e.target.matches('[data-adj],[data-geo]')) { setGrid(card); adjFinal(card); return; }     // 막대에서 손을 뗐을 때: 원래 크기로 한 번 더
    const act = e.target.dataset.act;
    if (act === 'select') { e.target.checked ? KK.selected.add(card.id) : KK.selected.delete(card.id); }
    if (act === 'space') { const old = KK.topicOf(card).g; if (KK.aiFix) KK.aiFix(card, e.target.value); card.topic = e.target.value; card.topicManual = true; card.topicAi = false; card.space = KK.topicOf(card).space; if (KK.topicOf(card).g !== old) card.feats = []; card.edited = false; KK.changed('text'); }
    if (act === 'lspace') { if (KK.aiFix) KK.aiFix(card, e.target.value.trim()); card.spaceName = e.target.value.trim(); card.spaceManual = true; card.spaceAi = false; card.spaceCont = false; { const tg = e.target.closest('label') && e.target.closest('label').querySelector('.ai-tag'); if (tg) tg.remove(); } KK.changed('text'); }
    if (act === 'gridN') { card.gridN = +e.target.value; setGrid(card); return; }
    if (act === 'layout') { card.layout = e.target.value; KK.changed('structure'); }
    if (act === 'hint') { card.hint = e.target.value.trim(); card.edited = false; KK.changed('text'); }
  });
  box.addEventListener('dblclick', e => {
    const gr = e.target.closest('[data-geo]');
    if (gr && gr.matches('input')) { const cd = cardById(gr.closest('[data-card]')?.dataset.card), p4 = KK.photos.get(cd && geoPidOf(cd)); if (cd && p4) { setGeo(p4, gr.dataset.geo, 0); syncLevel(cd); adjFinal(cd); } return; }
    const r = e.target.closest('[data-adj]'); if (!r) return;
    const card = cardById(r.closest('[data-card]')?.dataset.card); if (!card) return;
    r.value = 0; r.nextElementSibling.textContent = '0'; setAdj(card, r.dataset.adj, 0); adjFinal(card);
  });
  box.addEventListener('input', e => {
    const geo = e.target.closest('input[data-geo]');
    if (geo) {
      const cd = cardById(geo.closest('[data-card]')?.dataset.card), p5 = KK.photos.get(cd && geoPidOf(cd)); if (!cd || !p5) return;
      setGeo(p5, geo.dataset.geo, +geo.value); geo.nextElementSibling.textContent = fmtGeo(geo.dataset.geo, p5.adj[geo.dataset.geo]);
      setGrid(cd, true); adjLiveGo(cd); return;
    }
    const r = e.target.closest('[data-adj]');
    if (r) {
      const card = cardById(r.closest('[data-card]')?.dataset.card); if (!card) return;
      r.nextElementSibling.textContent = fmtAdj(+r.value); setAdj(card, r.dataset.adj, +r.value); adjLiveGo(card); return;
    }
    if (e.target.dataset.act !== 'text') return;
    const card = cardById(e.target.closest('[data-card]')?.dataset.card); if (!card) return;
    card.text = e.target.value; card.edited = true; KK.changed('typing');
  });

  /* 드래그: 카드 머리(⠿)를 끌면 카드 순서, 작은 사진을 끌면 콜라주 안/다른 카드로 이동 */
  let drag = null;
  const clear = () => box.querySelectorAll('.drop-before,.drop-after,.drop-into,.drop-merge,.dragging').forEach(n => n.classList.remove('drop-before', 'drop-after', 'drop-into', 'drop-merge', 'dragging'));
  // 카드 위 25% / 아래 25% = 순서 이동, 가운데 = 콜라주로 합치기
  const zone = (cardEl, e) => { const r = cardEl.getBoundingClientRect(), y = (e.clientY - r.top) / r.height; return y < .25 ? 'before' : y > .75 ? 'after' : 'merge'; };
  box.addEventListener('dragstart', e => {
    const thumb = e.target.closest('.thumb');
    if (thumb) { drag = { type: 'photo', photo: thumb.dataset.photo, from: thumb.closest('[data-card]').dataset.card }; thumb.classList.add('dragging'); }
    else if (e.target.closest('.card-head') || e.target.closest('.preview-img')) { const c = e.target.closest('[data-card]'); drag = { type: 'card', id: c.dataset.card }; c.classList.add('dragging'); }
    else return;
    e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'kk');
  });
  box.addEventListener('dragend', () => { drag = null; clear(); });
  box.addEventListener('dragover', e => {
    if (!drag) return;
    const card = e.target.closest('[data-card]'); if (!card) return;
    e.preventDefault(); clear();
    if (drag.type === 'card') {
      if (card.dataset.card === drag.id) return;
      card.classList.add('drop-' + zone(card, e));
    } else {
      const t = e.target.closest('.thumb');
      if (t) { const r = t.getBoundingClientRect(); t.classList.add(e.clientX < r.left + r.width / 2 ? 'drop-before' : 'drop-after'); }
      else card.classList.add('drop-into');
    }
  });
  box.addEventListener('drop', e => {
    if (!drag) return; e.preventDefault();
    const cardEl = e.target.closest('[data-card]'); if (!cardEl) return;
    const cards = S().cards, target = cardById(cardEl.dataset.card);
    if (drag.type === 'card') {
      const moving = cardById(drag.id); if (!moving || moving === target) return;
      const z = zone(cardEl, e);
      if (z === 'merge') {
        if (target.photoIds.length + moving.photoIds.length > MAX_IN_COLLAGE) { KK.toast('콜라주는 최대 ' + MAX_IN_COLLAGE + '장까지예요.', 'error'); drag = null; clear(); return; }
        target.photoIds.push(...moving.photoIds); target.edited = false;
        cards.splice(cards.indexOf(moving), 1);
        KK.toast('콜라주로 합쳤어요. 사진을 빼려면 작은 사진의 [분리]를 누르세요.', 'ok');
      } else {
        cards.splice(cards.indexOf(moving), 1);
        cards.splice(cards.indexOf(target) + (z === 'after' ? 1 : 0), 0, moving);
      }
    } else {
      const from = cardById(drag.from);
      if (target !== from && target.photoIds.length >= MAX_IN_COLLAGE) { KK.toast('콜라주는 최대 ' + MAX_IN_COLLAGE + '장까지예요.', 'error'); return; }
      from.photoIds = from.photoIds.filter(x => x !== drag.photo);
      const t = e.target.closest('.thumb');
      let idx = target.photoIds.length;
      if (t && t.dataset.photo !== drag.photo) { const r = t.getBoundingClientRect(); idx = target.photoIds.indexOf(t.dataset.photo) + (e.clientX >= r.left + r.width / 2 ? 1 : 0); }
      target.photoIds.splice(Math.max(0, idx), 0, drag.photo);
      if (from !== target) { from.edited = false; target.edited = false; }
      removeEmpty();
    }
    drag = null; clear(); KK.changed('structure');
  });
}

/* ── 대표사진 1:1 ── */
let coverTicket = 0;
/* 1080×1080 안에서 사진이 놓이는 자리 (iw×ih 사진을 채움/전체 · 확대 · 위치로) — 화면용과 내보내기용이 같은 자리를 써요 */
KK.coverRect = (cv, iw, ih) => {
  const base = cv.fit === 'contain' ? Math.min(1080 / iw, 1080 / ih) : Math.max(1080 / iw, 1080 / ih);
  const z = cv.zoom / 100, w = iw * base * z, h = ih * base * z;
  return { w, h, x: (1080 - w) / 2 + Math.abs(1080 - w) / 2 * cv.x / 100, y: (1080 - h) / 2 + Math.abs(1080 - h) / 2 * cv.y / 100 };
};
KK.renderCover = async () => {
  const t = ++coverTicket, s = S(), canvas = $('coverCanvas'), ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1080, 1080);
  const p = KK.photos.get(s.cover.photoId);
  $('coverEmpty').hidden = !!p;
  if (!p) { KK.coverData = ''; return ''; }
  const img = await loadImage(await KK.photoData(p)); if (t !== coverTicket) return KK.coverData;
  const r = KK.coverRect(s.cover, img.width, img.height);
  ctx.drawImage(img, r.x, r.y, r.w, r.h);
  KK.coverData = canvas.toDataURL('image/jpeg', .92);
  return KK.coverData;
};
function bindCover() {
  for (const k of ['fit', 'zoom', 'x', 'y']) {
    const el = $('cover_' + k);
    el.addEventListener('input', () => { S().cover[k] = k === 'fit' ? el.value : Number(el.value); KK.changed('cover'); });
  }
  $('coverReset').addEventListener('click', () => { Object.assign(S().cover, { zoom: 100, x: 0, y: 0 }); KK.syncCoverInputs(); KK.changed('cover'); });
  $('coverDownload').addEventListener('click', async () => {
    const b = await KK.exportCover(); if (!b) return KK.toast('대표사진이 없어요.', 'error');
    KK.download('키친앤코_대표사진_1080.jpg', b);
  });
}
KK.syncCoverInputs = () => { for (const k of ['fit', 'zoom', 'x', 'y']) $('cover_' + k).value = S().cover[k]; };

/* ── 업로드 영역 ── */
function bindDrop() {
  const drop = $('drop');
  $('photoInput').addEventListener('change', async e => { await KK.takeFiles(e.target.files); e.target.value = ''; });
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); drop.classList.add('over'); } }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, () => drop.classList.remove('over')));
  drop.addEventListener('drop', e => { if (e.dataTransfer?.files?.length) { e.preventDefault(); KK.takeFiles(e.dataTransfer.files); } });
  $('autoPair').addEventListener('click', KK.autoPair);
  $('autoLevelAll').addEventListener('click', () => KK.autoLevelAll());
  $('autoToneAll').addEventListener('click', () => KK.autoToneAll());
  $('autoLevelOn').checked = autoLevelOn();
  $('autoLevelOn').addEventListener('change', () => { try { localStorage.setItem('kk-auto-level', $('autoLevelOn').checked ? '1' : '0'); } catch (_) {} });
  $('mergeSel').addEventListener('click', KK.mergeSelected);
}
/* ── 사진 순서 한눈에 보기 (2.10.32) ──
   카드 목록이 길어서 순서·콜라주를 바꾸기 힘들던 것을, 맨 앞에 작은 미리보기 줄로 보여 주고 끌어서 한 번에 고치게 했어요.
   · 묶음(카드) 하나 = 상자 하나. 번호표를 끌면 묶음 순서, 작은 사진을 끌어 다른 상자에 놓으면 콜라주로 합치기, 상자 사이 빈틈에 놓으면 따로 떼기.
   · 카드 목록 쪽 끌기와 같은 자료(S().cards)를 바꿔서, 어느 쪽에서 해도 결과가 같아요. */
KK.renderStrip = () => {
  const det = $('photoStrip'); if (!det) return; const s = S(), row = $('pstripRow');
  det.hidden = !s.cards.length; if (!s.cards.length) { row.innerHTML = ''; return; }
  $('pstripSum').textContent = s.cards.length + '묶음 · 사진 ' + s.cards.reduce((n, c) => n + c.photoIds.length, 0) + '장';
  const gap = i => `<div class="pgap" data-gap="${i}" title="여기에 놓으면 따로 떼어 이 자리에 넣어요"></div>`;
  row.innerHTML = s.cards.map((c, i) => {
    const multi = c.photoIds.length > 1;
    const pts = c.photoIds.map(pid => { const p = KK.photos.get(pid); return p ? `<div class="pt${pid === s.cover.photoId ? ' cover' : ''}" draggable="true" data-pid="${pid}" title="${esc(p.name || '')}${pid === s.cover.photoId ? ' · 대표사진' : ''}"><img src="${p.data}" alt="" draggable="false"></div>` : ''; }).join('');
    return gap(i) + `<div class="pg${multi ? ' multi' : ''}" data-pgc="${c.id}"><span class="pg-num" draggable="true" title="끌어서 이 묶음의 순서를 바꿔요 · 누르면 아래 해당 카드로 가요">${i + 1}${multi ? '<small>콜라주 ' + c.photoIds.length + '</small>' : ''}</span><div class="pg-ph">${pts}</div></div>`;
  }).join('') + gap(s.cards.length);
};
function bindStrip() {
  const box = $('photoStrip'); if (!box) return; const row = $('pstripRow');
  let drag = null;
  const clear = () => { row.querySelectorAll('.drop-before,.drop-after,.drop-into,.on,.dragging').forEach(n => n.classList.remove('drop-before', 'drop-after', 'drop-into', 'on', 'dragging')); };
  const half = (el, e) => { const r = el.getBoundingClientRect(); return e.clientX < r.left + r.width / 2 ? 'before' : 'after'; };
  row.addEventListener('dragstart', e => {
    const pt = e.target.closest('.pt'), num = e.target.closest('.pg-num');
    if (pt) { drag = { type: 'photo', pid: pt.dataset.pid, from: pt.closest('.pg').dataset.pgc }; pt.classList.add('dragging'); }
    else if (num) { const g = num.closest('.pg'); drag = { type: 'card', id: g.dataset.pgc }; g.classList.add('dragging'); }
    else return;
    e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'kk-strip');
  });
  row.addEventListener('dragend', () => { drag = null; clear(); });
  row.addEventListener('dragover', e => {
    if (!drag) return;
    const gp = e.target.closest('.pgap'), g = e.target.closest('.pg'), pt = e.target.closest('.pt');
    if (!gp && !g) return;
    e.preventDefault(); clear();
    if (gp) { gp.classList.add('on'); return; }
    if (drag.type === 'card') { if (g.dataset.pgc !== drag.id) g.classList.add('drop-' + half(g, e)); return; }
    if (pt && pt.dataset.pid !== drag.pid) pt.classList.add('drop-' + half(pt, e)); else if (!pt) g.classList.add('drop-into');
  });
  row.addEventListener('drop', e => {
    if (!drag) return; const d = drag; drag = null; clear(); e.preventDefault();
    const gp = e.target.closest('.pgap'), g = e.target.closest('.pg'), pt = e.target.closest('.pt');
    if (!gp && !g) return;
    const s = S(), cards = s.cards;
    if (d.type === 'card') {
      const moving = cardById(d.id); if (!moving) return;
      let at;                                           // 넣을 자리 (카드 사이 번호)
      if (gp) at = +gp.dataset.gap; else { const t = cardById(g.dataset.pgc); if (!t || t === moving) return; at = cards.indexOf(t) + (half(g, e) === 'after' ? 1 : 0); }
      const from = cards.indexOf(moving); cards.splice(from, 1); cards.splice(at > from ? at - 1 : at, 0, moving);
      KK.changed('structure'); return;
    }
    const from = cardById(d.from); if (!from || !from.photoIds.includes(d.pid)) return;
    if (gp) {                                           // 빈틈: 따로 떼어 이 자리에
      let at = +gp.dataset.gap;
      if (from.photoIds.length === 1) { const f = cards.indexOf(from); cards.splice(f, 1); cards.splice(at > f ? at - 1 : at, 0, from); }   // 혼자인 카드는 글을 지키려고 카드째 옮겨요
      else { from.photoIds = from.photoIds.filter(x => x !== d.pid); cards.splice(at, 0, newCard([d.pid], from.topic)); }
      KK.changed('structure'); return;
    }
    const target = cardById(g.dataset.pgc); if (!target) return;
    if (target !== from && target.photoIds.length >= MAX_IN_COLLAGE) { KK.toast('콜라주는 최대 ' + MAX_IN_COLLAGE + '장까지예요.', 'error'); return; }
    from.photoIds = from.photoIds.filter(x => x !== d.pid);
    let idx = target.photoIds.length;
    if (pt && pt.dataset.pid !== d.pid) idx = target.photoIds.indexOf(pt.dataset.pid) + (half(pt, e) === 'after' ? 1 : 0);
    target.photoIds.splice(Math.max(0, idx), 0, d.pid);   // 직접 쓴·Claude가 쓴 문단은 그대로 둬요 (글을 새로 만들려면 카드의 [처음대로]나 글 다시 쓰기)
    removeEmpty(); KK.changed('structure');
    if (from !== target && target.photoIds.length > 1) KK.toast('콜라주로 합쳤어요. 빼려면 사진을 상자 사이 빈틈에 끌어다 놓으세요.', 'ok');
  });
  row.addEventListener('click', e => {      // 번호표·사진을 누르면 아래 해당 카드로 이동
    const g = e.target.closest('.pg'); if (!g) return; const el = document.querySelector(`#cards [data-card="${g.dataset.pgc}"]`); if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1400);
  });
}
KK.initPhotos = () => { bindDrop(); bindCards(); bindStrip(); bindCover(); };

})();
