/* 부동산 찾기 — 네이버 부동산에서 단지를 찾아 면적(타입)과 도면 그림까지 가져와요. (2.10.37)
   ① [부동산에서 자동으로 찾기]: 크롬 확장이 백그라운드 탭에서 단지 검색 → (후보가 여러 개면 고르기) → 평형 목록·면적·도면을 읽어 와요. 읽기만 하고 발행·클릭 등록은 없어요.
   ② 평형(타입) 칩을 누르면 그 타입의 전용면적과 도면을 다시 읽어 와요.
   자동이 안 될 때를 위해 예전 방식(열려 있는 네이버 부동산 탭 읽기 / 붙여넣기 / 직접 입력)은 [자동으로 안 될 때] 칸에 남겨 뒀어요.
   도면 그림은 내 PC 서버(/api/land/image)가 받아 오고, 직접 파일을 넣거나 캡처를 붙여넣을 수도 있어요.
   읽은 면적·고른 타입은 글 상태(KK.state.site)에 저장돼 다시 실행해도 남아요. 도면 미리보기는 따로 저장(kk2-site-plan-*)해서 저장 공간이 모자라도 글 저장은 영향이 없어요. */
(() => {
'use strict';
const KK = window.KK, { $, esc } = KK, P = window.KKPlaces;
const MIN_EXT = '2.10.5', IMG_EXT = '2.10.31', MIN_LAND = '2.10.23', PY = 3.305785, WS = ['src', 'tgt'];
const ROLE = { src: { badge: 'A', title: '원본 시공 현장', sub: '실제로 시공한 현장' }, tgt: { badge: 'B', title: '추천 대상 현장', sub: '디자인을 추천할 현장' } };
const pyOf = v => { const n = parseFloat(v); return n > 0 ? (n / PY).toFixed(1) + '평' : ''; };
const lemon = () => KK.brandKey === 'lemon';
const mirrors = w => (w === 'tgt') === lemon();            // 블로그 화면의 아파트명·지역을 따라가는 쪽: 키친앤코=시공 현장, 레몬하우스=추천 글 현장
const visible = w => w === 'src' || lemon();
const blank = () => ({ name: '', region: '', own: false, auto: false, url: '', read: '', areas: [], type: '', supply: '', excl: '', plan: '', planName: '', man: { type: '', supply: '', excl: '' } });
const tmp = () => ({ busy: false, seq: 0, imgs: [], msg: '', kind: '', full: '', thumb: '', restoring: false, cands: [], diag: '', first: null, manualOpen: false, tick: 0, t0: 0, base: '' });
const T = { src: tmp(), tgt: tmp() };
const PLAN_KEY = w => 'kk2-site-plan-' + w;
const keyOf = c => P.placeName(c.name) + '|' + P.addressKey(c.region);
const planKey = c => c.plan || (c.planName ? 'file:' + c.planName : '');

function norm() {
  const S = KK.state; if (!S.site || typeof S.site !== 'object') S.site = {};
  const x = S.site; if (x.use == null) x.use = true; delete x.auto;
  for (const w of WS) { const o = x[w] && typeof x[w] === 'object' ? x[w] : {}; x[w] = Object.assign(blank(), o); delete x[w].det; if (!Array.isArray(x[w].areas)) x[w].areas = []; x[w].man = Object.assign({ type: '', supply: '', excl: '' }, o.man); }
  if (!x.cmp || typeof x.cmp !== 'object') x.cmp = null;
  return x;
}
const site = () => KK.state.site || norm();
const persist = () => { try { KK.persist && KK.persist(); } catch (_) {} };
const verOk = (v, min) => { const a = String(v || '0').split('.').map(Number), b = min.split('.').map(Number); for (let i = 0; i < 3; i++) if ((a[i] || 0) !== b[i]) return (a[i] || 0) > b[i]; return true; };
async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({})); if (!j.ok) throw Error(j.error || '요청에 실패했어요.'); return j;
}
async function needExt(min) {
  if (!KK.extVersion && KK.checkExtension) await KK.checkExtension();
  if (!KK.extVersion) throw Error('크롬 확장 프로그램이 연결되지 않았어요. 사용방법.txt의 확장 설치 순서를 확인하거나, 네이버 부동산 페이지에서 Ctrl+A → Ctrl+C 한 내용을 아래 칸에 붙여넣어 주세요.');
  if (!verOk(KK.extVersion, min || MIN_EXT)) throw Error('크롬 확장 프로그램이 옛 버전(v' + KK.extVersion + ')이에요. chrome://extensions 에서 이 확장의 새로고침(↻)을 누르거나, 대신 네이버 부동산 페이지에서 Ctrl+A → Ctrl+C 한 내용을 아래 칸에 붙여넣어 주세요.');
}

/* ───── 이미지: 불러오기 · 줄이기 · 저장 ───── */
const loadImg = src => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(Error('이미지를 읽지 못했어요.')); im.src = src; });
const readFile = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(Error('파일을 읽지 못했어요.')); r.readAsDataURL(f); });
function shrink(im, max, q) {
  const sc = Math.min(1, max / Math.max(im.naturalWidth || im.width, im.naturalHeight || im.height)), c = document.createElement('canvas');
  c.width = Math.max(1, Math.round((im.naturalWidth || im.width) * sc)); c.height = Math.max(1, Math.round((im.naturalHeight || im.height) * sc));
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', q);
}
function saveThumb(w) {
  const c = site()[w], t = T[w];
  try {
    if (!t.thumb || !planKey(c)) localStorage.removeItem(PLAN_KEY(w));
    else localStorage.setItem(PLAN_KEY(w), JSON.stringify({ k: planKey(c), thumb: t.thumb }));
  } catch (_) { /* 저장 공간이 모자라면 다음에 열 때 다시 받아 와요 */ }
}
function loadThumb(w) {
  const c = site()[w], t = T[w];
  try { const o = JSON.parse(localStorage.getItem(PLAN_KEY(w)) || 'null'); if (o && planKey(c) && o.k === planKey(c) && /^data:image\//.test(o.thumb || '')) t.thumb = o.thumb; } catch (_) {}
}
async function setPlanFromData(w, data, extra) {
  const c = site()[w], t = T[w], im = await loadImg(data);
  t.full = shrink(im, 1600, .88); t.thumb = shrink(im, 700, .74);
  Object.assign(c, extra); saveThumb(w);
}
async function usePlan(w, url) {   // 네이버 도면 이미지 주소 → 서버가 받아 와서 화면에 보여 줘요
  const c = site()[w], t = T[w];
  if (!url) { c.plan = ''; c.planName = ''; t.full = ''; t.thumb = ''; saveThumb(w); return true; }
  try { const j = await post('/api/land/image', { url }); await setPlanFromData(w, j.data, { plan: url, planName: '' }); return true; }
  catch (e) { c.plan = ''; c.planName = ''; t.full = ''; t.thumb = ''; saveThumb(w); t.kind = 'warn'; t.msg = '도면 그림을 받지 못했어요 — ' + e.message; return false; }
}
function clearResult(w) {
  const c = site()[w], t = T[w]; t.seq++; t.busy = false; clearInterval(t.tick); t.tick = 0;
  Object.assign(c, { auto: false, url: '', read: '', areas: [], type: '', supply: '', excl: '', plan: '', planName: '', man: { type: '', supply: '', excl: '' } });
  Object.assign(t, { imgs: [], msg: '', kind: '', full: '', thumb: '', cands: [], diag: '', first: null }); saveThumb(w);
  site().cmp = null;
}
function end(w) { const t = T[w]; t.busy = false; clearInterval(t.tick); t.tick = 0; renderBody(w); renderCmp(); renderPill(); persist(); }

/* ───── 읽기 흐름: 열려 있는 네이버 부동산 탭(또는 붙여넣은 글) → 면적·타입 칩 → 고르기 → 도면 ───── */
const areaType = a => a.supply ? a.supply + (a.letter || '') + '㎡' : Math.round(a.py * 10) / 10 + (a.letter || '') + '평';
const areaLabel = a => a.supply ? (a.letter ? a.letter + ' ' : '') + a.supply + '㎡' : (a.letter ? a.letter + ' ' : '') + (Math.round(a.py * 10) / 10) + '평';
const siteName = title => { const m = /^(.*?)\s*[:\-|–·]\s*네이버\s*(?:부동산)?/.exec(String(title || '')); const n = m ? m[1].trim() : ''; return n.length >= 2 && n.length <= 30 ? n.replace(/^아파트\s+/, '') : ''; };
function pickArea(w, a) {
  const c = site()[w];
  Object.assign(c, { type: areaType(a), supply: a.supply ? String(a.supply) : '', excl: a.excl ? String(a.excl) : '', man: { type: '', supply: '', excl: '' } });
  site().cmp = null;
}
// 읽은 글에서 면적을 찾아 칩으로 보여 줘요. 1종뿐이면 바로 확정.
function applyText(w, text, extra) {
  const c = site()[w], t = T[w], items = KK.landParse.parseAreas(text).map(a => ({ supply: a.supply || 0, excl: a.excl || 0, letter: a.letter || '', py: Math.round(a.py * 100) / 100 }));
  if (!items.length) { t.kind = 'warn'; t.msg = '면적(예: 113.67Am²)을 찾지 못했어요. 네이버 부동산 단지 페이지의 [면적 정보]가 보이는 상태에서 다시 읽거나 복사해 주세요. 평수만 알면 34A 처럼 적고 Enter를 눌러도 돼요.'; return false; }
  if (extra && extra.read) c.read = extra.read; if (extra && extra.url) c.url = extra.url;
  c.auto = !!(extra && extra.auto); c.areas = items; site().cmp = null;
  const cur = items.find(a => areaType(a) === c.type);
  if (items.length === 1) pickArea(w, items[0]); else if (!cur) Object.assign(c, { type: '', supply: '', excl: '', man: { type: '', supply: '', excl: '' } });
  t.kind = 'ok'; t.msg = '면적 ' + items.length + '종을 읽었어요' + (items.length > 1 && !cur ? ' — 실제 현장의 평형(타입)을 눌러 골라 주세요.' : '.');
  return true;
}
async function readTab(w) {
  const c = site()[w], t = T[w]; if (t.busy) return; const n = ++t.seq;
  t.busy = true; t.msg = '열려 있는 네이버 부동산 탭을 읽는 중…'; t.kind = ''; renderBody(w);
  try {
    await needExt();
    const r = await KK.ext('READ_LAND', {}, 25000);
    if (n !== t.seq) return;
    if (!r.ok) throw Error(r.error || '읽지 못했어요.');
    const nm = siteName(r.title);
    const ok = applyText(w, r.text, { read: nm, url: /^https:\/\//.test(r.url || '') ? r.url : '' });
    if (ok && nm && c.name.trim() && P.placeName(nm) !== P.placeName(c.name) && !P.placeName(nm).includes(P.placeName(c.name)) && !P.placeName(c.name).includes(P.placeName(nm))) { t.kind = 'warn'; t.msg += ' ※ 읽은 페이지의 단지는 「' + nm + '」인데 이 칸의 아파트명은 「' + c.name + '」이에요. 맞는 단지 페이지가 열려 있는지 확인해 주세요.'; }
    if (ok) await takeImages(w, r.images, n);
  } catch (e) { if (n === t.seq) { t.kind = 'warn'; t.msg = e.message || String(e); } }
  if (n === t.seq) end(w);
}
// 열린 탭에 보이는 도면 그림 후보: 도면으로 보이는 것이 있으면 첫 번째를 쓰고, 나머지는 눌러서 바꿀 수 있게 보여 줘요.
async function takeImages(w, images, n) {
  const c = site()[w], t = T[w];
  if (!Array.isArray(images)) { t.imgs = []; t.msg += ' (도면 그림은 크롬 확장 프로그램이 새 버전(v' + IMG_EXT + ')이어야 가져와요 — chrome://extensions 에서 이 확장의 새로고침(↻)을 누르거나 아래 [도면 파일 넣기]를 쓰세요.)'; return; }
  t.imgs = images.filter(x => x && /^https:\/\//.test(x.url || '')).slice(0, 12).map(x => ({ url: x.url, alt: String(x.alt || '').slice(0, 40), plan: !!x.plan }));
  if (!t.imgs.length) { t.msg += ' 열린 페이지에서 도면 그림은 찾지 못했어요 — 도면이 보이는 화면에서 다시 읽거나 아래 [도면 파일 넣기]를 쓰세요.'; return; }
  const first = t.imgs.find(x => x.plan);
  if (!first) { t.msg += ' 도면으로 보이는 그림은 ' + t.imgs.length + '장이에요 — 아래에서 도면이 맞는 그림을 눌러 주세요.'; return; }
  const base = t.msg; t.msg = base + ' 도면 그림을 가져오는 중…'; renderBody(w);
  const ok = await usePlan(w, first.url); if (n !== t.seq) return; site().cmp = null;
  if (ok) t.msg = base + ' 도면 그림도 가져왔어요 — 맞는 그림인지 확인해 주세요.'; else t.msg = base + ' ' + t.msg;
}
async function importImage(w, i) {
  const t = T[w], im = t.imgs[i]; if (!im || t.busy) return; const n = ++t.seq;
  t.busy = true; t.msg = '도면을 가져오는 중…'; t.kind = ''; renderBody(w);
  const ok = await usePlan(w, im.url); if (n !== t.seq) return; site().cmp = null; if (ok) { t.msg = ''; t.kind = ''; } end(w);
}
async function onFile(w, file) {
  const c = site()[w], t = T[w]; if (!file) return;
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { t.msg = '도면은 JPG·PNG 이미지 파일만 넣을 수 있어요. (PDF는 캡처해서 이미지로 넣어 주세요)'; t.kind = 'warn'; return renderBody(w); }
  try { await setPlanFromData(w, await readFile(file), { plan: '', planName: file.name.slice(0, 60) }); site().cmp = null; t.msg = '도면을 넣었어요.'; t.kind = 'ok'; }
  catch (e) { t.msg = e.message; t.kind = 'warn'; }
  end(w);
}
/* ───── 부동산 찾기: 크롬 확장이 네이버 부동산에서 단지 검색 → 후보 고르기 → 평형 목록·면적·도면 읽기 ───── */
const canon = s => String(s || '').replace(/\s/g, '');
const typeToArea = s => {
  const m = /^\s*(\d+(?:\.\d+)?)\s*([A-Za-z]{0,2})\s*(㎡|평)\s*$/.exec(String(s || '')); if (!m) return null;
  const n = parseFloat(m[1]); if (!(n > 0)) return null;
  const raw = String(s).trim(), letter = m[2].toUpperCase();
  return m[3] === '㎡' ? { supply: n, excl: 0, letter, py: Math.round(n / PY * 100) / 100, raw } : { supply: 0, excl: 0, letter, py: n, raw };
};
const elapsed = t => Math.max(0, Math.round((Date.now() - t.t0) / 1000));
function startBusy(w, msg, tag) {
  const t = T[w]; clearInterval(t.tick);
  t.busy = true; t.t0 = Date.now(); t.base = msg; t.msg = msg; t.kind = '';
  t.tick = setInterval(() => { const el = document.querySelector(`.site-card[data-w="${w}"] [data-busy]`); if (el) el.textContent = t.base + ' ' + elapsed(t) + '초' + (elapsed(t) > 45 ? ' — 오래 걸리면 [멈추기]를 누르고 아래 [직접 읽기]를 써 보세요' : ''); }, 1000);
  renderBody(w);
}
function landErr(r) {
  const code = r && r.code, base = (r && r.error) || '네이버 부동산 조회에 실패했어요.';
  if (code === 'login' || code === 'input' || code === 'notfound' || code === 'notype') return Error(base);
  return Error(base + ' 다시 눌러 보거나, 아래 [자동으로 안 될 때]의 직접 읽기를 써 주세요.');
}
const landFail = (w, n, e) => { const t = T[w]; if (n !== t.seq) return; t.kind = 'warn'; t.msg = e.message || String(e); t.manualOpen = true; };
function cancel(w) {
  const t = T[w]; t.seq++; t.busy = false; clearInterval(t.tick); t.tick = 0;
  t.kind = 'warn'; t.msg = '조회를 멈췄어요. (크롬에서 열린 조회 탭은 저절로 닫혀요. 바로 다시 누르면 앞 조회가 끝난 뒤에 시작돼요.)';
  renderBody(w); renderPill();
}
// 확장이 돌려준 단지 상세 → 평형 칩 · (1종이면) 바로 확정 · 도면
async function applyDetails(w, d, n, read) {
  const c = site()[w], t = T[w]; d = d || {};
  let items = [], seen = new Set();
  for (const s of d.types || []) { const a = typeToArea(s); if (a && !seen.has(areaType(a))) { seen.add(areaType(a)); items.push(a); } }
  const sup = parseFloat(d.supplyArea) || 0, ex = parseFloat(d.exclusiveArea) || 0, selA = typeToArea(d.selectedType);
  if (!items.length && selA) items = [selA];
  const imgs = (d.images || []).map(x => ({ url: String((x && x.url) || '').replace(/^http:\/\//, 'https://'), alt: (x && x.label) || '도면', plan: true }));
  if (!items.length) {
    if (!applyText(w, d.text || '', { read, url: d.url || '', auto: true })) { t.kind = 'warn'; t.msg = '단지는 열었지만 평형(면적) 목록을 읽지 못했어요. 아래 [자동으로 안 될 때]를 써 주세요.'; t.manualOpen = true; return false; }
    items = c.areas;
  } else {
    c.areas = items; c.auto = true; c.read = read || c.read; c.url = d.url || c.url; site().cmp = null;
  }
  // 열릴 때 기본으로 골라져 있던 평형의 전용면적·도면은 이미 읽었으니 보관해 둬요 (그 평형을 누르면 다시 읽지 않아요)
  const first = items.find(a => (selA && areaType(a) === areaType(selA)) || (sup && a.supply === sup));
  if (first) { if (ex > 0) first.excl = ex; t.first = { key: areaType(first), excl: ex, images: imgs }; } else t.first = null;
  const cur = items.find(a => areaType(a) === c.type);
  if (items.length === 1) { pickArea(w, items[0]); }
  else if (!cur) Object.assign(c, { type: '', supply: '', excl: '', man: { type: '', supply: '', excl: '' } });
  t.kind = 'ok';
  t.msg = '「' + (c.read || c.name) + '」 평형 ' + items.length + '종을 읽었어요' + (items.length > 1 && !cur ? ' — 실제 현장의 평형(타입)을 눌러 골라 주세요.' : '.');
  if (items.length === 1 && imgs.length) await takeImages(w, imgs, n);
  return true;
}
async function autoFind(w) {
  const c = site()[w], t = T[w]; if (t.busy) return;
  const name = c.name.trim();
  if (!name) { t.kind = 'warn'; t.msg = '아파트명을 먼저 적어 주세요.'; return renderBody(w); }
  const n = ++t.seq; t.cands = []; t.diag = ''; t.manualOpen = false;
  startBusy(w, '네이버 부동산에서 「' + name + '」 단지를 찾는 중…');
  try {
    await needExt(MIN_LAND);
    const r = await KK.ext('LAND_SEARCH', { query: name, region: c.region.trim() }, 150000);
    if (n !== t.seq) return;
    t.diag = r.diag || '';
    if (!r.ok) throw landErr(r);
    const list = (r.list || []).filter(x => x && x.label).slice(0, 8);
    if (!list.length) throw Error('「' + name + '」에 해당하는 단지를 찾지 못했어요. 아파트명(차수 포함)을 확인해 주세요.');
    const exact = list.filter(x => P.placeName(x.complexName) === P.placeName(name));
    const pick = list.length === 1 ? 0 : exact.length === 1 ? list.indexOf(exact[0]) : -1;
    t.cands = list;
    if (pick >= 0) return pickCand(w, pick, n);
    t.kind = 'ok'; t.msg = '후보 ' + list.length + '곳을 찾았어요 — 맞는 단지를 눌러 주세요.';
  } catch (e) { landFail(w, n, e); }
  if (n === t.seq) end(w);
}
async function pickCand(w, i, n0) {
  const c = site()[w], t = T[w], cand = t.cands[i]; if (!cand || (t.busy && !n0)) return;
  const n = n0 || ++t.seq, label = cand.complexName || cand.name;
  startBusy(w, '「' + label + '」 평형·면적·도면을 읽는 중… (보통 20~40초)');
  try {
    await needExt(MIN_LAND);
    const r = await KK.ext('LAND_SELECT', { query: c.name.trim(), region: c.region.trim(), label: cand.label, complexName: cand.complexName || '', type: '' }, 180000);
    if (n !== t.seq) return;
    t.diag = r.diag || '';
    if (!r.ok) throw landErr(r);
    clearResultKeepName(w);
    const nm = String(label).replace(/^아파트\s+/, '').trim();
    const ok = await applyDetails(w, r.details, n, nm);
    if (n !== t.seq) return;
    if (ok) t.cands = [];
  } catch (e) { landFail(w, n, e); }
  if (n === t.seq) end(w);
}
// 단지를 새로 고르면 이전 결과(타입·도면)는 비워요 (아파트명·지역은 그대로)
function clearResultKeepName(w) {
  const c = site()[w], t = T[w];
  Object.assign(c, { auto: false, url: '', read: '', areas: [], type: '', supply: '', excl: '', plan: '', planName: '', man: { type: '', supply: '', excl: '' } });
  Object.assign(t, { imgs: [], full: '', thumb: '', first: null }); saveThumb(w); site().cmp = null;
}
// 평형(타입) 칩을 눌렀을 때: 그 타입의 전용면적·도면을 읽어 와요 (자동으로 찾은 단지일 때만)
async function autoType(w, a) {
  const c = site()[w], t = T[w]; if (t.busy) return; const n = ++t.seq, key = areaType(a);
  pickArea(w, a); t.kind = ''; t.msg = ''; t.imgs = []; renderPill();
  const f = t.first && t.first.key === key ? t.first : null;
  if (f) {   // 열릴 때 이미 읽어 둔 평형
    if (f.excl > 0) { c.excl = String(f.excl); a.excl = f.excl; }
    t.msg = key + ' 면적을 불러왔어요.'; t.kind = 'ok'; site().cmp = null;
    if (f.images && f.images.length) await takeImages(w, f.images, n); else { c.plan = ''; c.planName = ''; t.full = t.thumb = ''; saveThumb(w); t.msg += ' (이 타입의 도면 그림은 없어요 — 아래 [도면 파일 넣기]를 쓰세요.)'; }
    if (n === t.seq) end(w); return;
  }
  c.plan = ''; c.planName = ''; t.full = t.thumb = ''; saveThumb(w);
  startBusy(w, '「' + key + '」 전용면적·도면을 읽는 중… (보통 20~40초)');
  try {
    await needExt(MIN_LAND);
    const r = await KK.ext('LAND_DETAILS', { url: c.url, type: a.raw || key }, 180000);
    if (n !== t.seq) return;
    t.diag = r.diag || '';
    if (!r.ok) throw landErr(r);
    const d = r.details || {}, ex = parseFloat(d.exclusiveArea) || 0, sup = parseFloat(d.supplyArea) || 0;
    if (ex > 0) { c.excl = String(ex); a.excl = ex; }
    if (sup > 0 && !c.supply) c.supply = String(sup);
    t.kind = 'ok'; t.msg = key + ' 면적을 읽었어요' + (ex > 0 ? ' (전용 ' + ex + '㎡).' : '.'); site().cmp = null;
    const imgs = (d.images || []).map(x => ({ url: String((x && x.url) || '').replace(/^http:\/\//, 'https://'), alt: (x && x.label) || '도면', plan: true }));
    if (imgs.length) await takeImages(w, imgs, n); else t.msg += ' 도면 그림은 찾지 못했어요 — 아래 [도면 파일 넣기]를 쓰세요.';
  } catch (e) { landFail(w, n, e); }
  if (n === t.seq) end(w);
}

/* ───── 블로그 화면의 아파트명·지역을 따라가기 / 직접 고치기 ───── */
function setNameRegion(w, name, region) {
  const c = site()[w], same = P.placeName(c.name) === P.placeName(name), regionSame = P.addressKey(c.region) === P.addressKey(region);
  c.name = name; c.region = region;
  if (!same || !regionSame) { if (c.areas.length || c.type || c.url || c.plan || c.planName) clearResult(w); }
}
function syncFromBlog() {
  const S = KK.state, x = site(); let changed = false;
  for (const w of WS) {
    const c = x[w]; if (!mirrors(w) || c.own) continue;
    const name = S.apt || '', region = S.region || '';
    if (c.name !== name || c.region !== region) { setNameRegion(w, name, region); changed = true; }
  }
  if (changed) { renderHeads(); renderAll(); persist(); }
}

/* ───── 도면 비교 (Claude Code) ───── */
const sigOf = x => [x.src.type, planKey(x.src), x.tgt.type, planKey(x.tgt)].join('|');
const infoOf = c => ({ name: c.read || c.name, address: c.region, type: c.type, supplyArea: c.supply ? c.supply + '㎡' : '', exclusiveArea: c.excl ? c.excl + '㎡' : '' });
async function fullFor(w) {
  const c = site()[w], t = T[w]; if (t.full) return t.full;
  if (c.plan) { const j = await post('/api/land/image', { url: c.plan }); await setPlanFromData(w, j.data, {}); return t.full; }
  if (t.thumb) return t.thumb; throw Error((ROLE[w].title) + '의 도면이 없어요.');
}
const strs = (a, n, m) => (Array.isArray(a) ? a : []).map(s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, m)).filter(Boolean).slice(0, n);
async function compare() {
  const x = site(), st = $('siteCmpStatus'); const say = (m, k) => { if (st) { st.hidden = !m; st.textContent = m || ''; st.className = 'status ' + (k || ''); } };
  const btn = document.querySelector('[data-act=compare]'); if (btn) btn.disabled = true;
  try {
    say('두 도면을 준비하는 중…');
    const a = await fullFor('src'), b = await fullFor('tgt');
    if (!KK.runClaude) throw Error('Claude 연결을 찾지 못했어요. 화면을 새로고침해 주세요.');
    const prompt = '두 아파트 도면을 비교하세요. 첨부한 A_original.jpg 는 원본 현장 A, B_target.jpg 는 추천 대상 현장 B 의 도면입니다. 두 파일을 모두 열어 직접 보고, 방·욕실 수, 거실·주방·현관 위치, 동선을 도면에서 읽히는 범위만 비교하세요. 공급면적과 전용면적은 구분해서 쓰세요. 치수나 구조 변경 가능성·내력벽은 추정하지 말고, 도면으로 알 수 없는 부분은 unknowns 에 적으세요. 근거 없는 유사도 점수는 쓰지 마세요.\n\n[현장 정보 — 네이버 부동산 조회값]\n' + JSON.stringify({ A: infoOf(x.src), B: infoOf(x.tgt) })
      + '\n\n[출력 형식 — JSON 하나만, 설명·코드블록 없이]\n{"summary":"한두 문장 요약","similarities":["공통점"],"differences":["차이점"],"unknowns":["도면으로 알 수 없는 점"]}';
    const sig = sigOf(x);
    const text = await KK.runClaude(prompt, [{ name: 'A_original.jpg', data: await shrinkData(a) }, { name: 'B_target.jpg', data: await shrinkData(b) }], sec => say('Claude가 두 도면을 비교하는 중… ' + sec + '초 (보통 1~2분)'));
    const d = KK.looseJson(text);
    if (!d || typeof d.summary !== 'string') throw Error('Claude 답을 읽지 못했어요. 한 번 더 눌러 주세요.');
    if (sigOf(site()) !== sig) { say('비교하는 사이에 도면이나 타입이 바뀌어서 결과를 버렸어요. 다시 눌러 주세요.', 'warn'); return; }
    site().cmp = { summary: d.summary.replace(/\s+/g, ' ').trim().slice(0, 600), similarities: strs(d.similarities, 8, 200), differences: strs(d.differences, 8, 200), unknowns: strs(d.unknowns, 8, 200), reviewed: false, sig };
    say(''); persist(); renderCmp();
  } catch (e) { say(e.message, 'warn'); }
  finally { if (btn) btn.disabled = false; }
}
async function shrinkData(data) { const im = await loadImg(data); return shrink(im, 1400, .85); }

/* ───── 글 쓰기(Claude)에 넘길 현장 정보 ───── */
KK.siteContext = s => {
  if (!lemon()) return '';   // 키친앤코 블로그에는 [현장 면적·도면] 패널이 없다 — 예전에 읽어 둔 값이 남아 있어도 Claude에 넘기지 않는다
  const x = (s || KK.state).site; if (!x || x.use === false) return '';
  const line = (w, label) => {
    const c = x[w]; if (!c || !c.type && !c.supply && !(c.man && (c.man.type || c.man.supply))) return '';
    const type = c.type || (c.man && c.man.type) || '', sup = c.supply || (c.man && c.man.supply) || '', ex = c.excl || (c.man && c.man.excl) || '';
    const nm = c.read || c.name || '';
    return '- ' + label + (nm ? ' ' + nm : '') + ': ' + [type && '타입 ' + type, sup && '공급면적 ' + sup + '㎡(약 ' + pyOf(sup) + ')', ex && '전용면적 ' + ex + '㎡(약 ' + pyOf(ex) + ')'].filter(Boolean).join(' · ') + '\n';
  };
  let out = line('src', lemon() ? '원본 시공 현장' : '시공 현장') + (lemon() ? line('tgt', '추천 대상 현장') : '');
  const cmp = x.cmp && x.cmp.reviewed && lemon() && x.cmp.sig === sigOf(x) ? x.cmp : null;
  if (cmp) out += '- 도면 비교(사장님이 확인함): ' + cmp.summary + (cmp.similarities.length ? ' / 공통점: ' + cmp.similarities.join('; ') : '') + (cmp.differences.length ? ' / 차이점: ' + cmp.differences.join('; ') : '') + (cmp.unknowns.length ? ' / 도면으로 알 수 없는 점(단정하지 말 것): ' + cmp.unknowns.join('; ') : '') + '\n';
  return out ? '\n[현장 면적·도면 — 네이버 부동산 조회값, 참고용]\n' + out + '※ 위에 적힌 면적·타입·도면 비교만 사실로 씁니다. 적히지 않은 구조·치수·구조 변경 가능성은 지어내지 않습니다.\n※ 제목·본문·태그에는 평형과 공급/전용 면적을 기본적으로 쓰지 않습니다. 숫자 뒤에 m2, m², ㎡, 제곱미터, PY, 평형, 평대를 붙이는 표기는 쓰지 말고, 설명에 꼭 필요할 때만 위 면적에서 확인되는 평수를 \'34평\'처럼 한글 평으로 최소한 씁니다. 면적을 임의로 환산하거나 공급·전용을 혼동하지 않습니다.\n' : '';
};

/* ───── 화면 ───── */
const shell = w => `<div class="site-card ${w === 'tgt' ? 'lemon-only' : ''}" data-w="${w}">
  <div class="st-top"><span class="site-badge ${w}">${ROLE[w].badge}</span><div><b>${ROLE[w].title}</b><small>${ROLE[w].sub}</small></div><span class="pill" data-st></span></div>
  <div class="grid2"><label class="field">아파트명<input data-f="name" placeholder="예: 메트로시티" autocomplete="off"></label><label class="field">지역 <small>선택</small><input data-f="region" placeholder="예: 창원시 양덕동" autocomplete="off"></label></div>
  <div class="st-sync muted" data-sync></div>
  <div data-body></div>
</div>`;
function renderHeads() {
  for (const w of WS) {
    const root = document.querySelector(`.site-card[data-w="${w}"]`); if (!root) continue; const c = site()[w];
    for (const f of ['name', 'region']) { const el = root.querySelector(`[data-f=${f}]`); if (el && el.value !== c[f] && document.activeElement !== el) el.value = c[f]; }
    root.querySelector('[data-sync]').textContent = mirrors(w) && !c.own ? '위 [현장 정보]의 아파트명·지역을 따라가요. 여기서 고치면 이 칸만 따로 써요.' : '';
  }
}
function statusOf(w) {
  const c = site()[w], t = T[w];
  if (t.busy) return ['읽는 중…', ''];
  if (t.cands.length && !c.areas.length) return ['단지를 골라 주세요', 'bad'];
  if (c.type && (c.supply || c.excl)) return ['확인됨 · ' + c.type, 'ok'];
  if (c.type) return ['타입만 · ' + c.type, ''];
  if (c.areas.length) return ['평형을 골라 주세요', 'bad'];
  return ['읽기 전', ''];
}
function bodyHtml(w) {
  const c = site()[w], t = T[w], dis = t.busy ? ' disabled' : '', img = t.thumb || t.full;
  const hasName = !!c.name.trim();
  let h = `<div class="st-step"><b><i>1</i> 단지 · 면적 · 타입</b></div>
  <div class="btns"><button type="button" class="btn primary" data-act="auto"${hasName && !t.busy ? '' : ' disabled'}>부동산에서 자동으로 찾기</button>${t.busy ? '<button type="button" class="btn ghost" data-act="cancel">멈추기</button>' : ''}</div>`;
  if (!c.areas.length && !t.msg && !c.type && !t.cands.length) h += `<p class="help">${hasName ? '위의 아파트명으로 네이버 부동산에서 단지를 찾아 평형·면적·도면까지 가져와요. 크롬에 조회 탭이 잠깐 열렸다 닫혀요 (20~40초).' : '먼저 위 칸에 아파트명을 적어 주세요.'} 잘 안 되면 아래 [자동으로 안 될 때]를 쓰세요.</p>`;
  if (t.busy) h += `<div class="status" data-busy>${esc(t.msg)}</div>`;
  else if (t.msg) h += `<div class="status ${t.kind}">${esc(t.msg)}</div>`;
  if (t.cands.length && !t.busy) h += `<div class="st-cands"><p class="help">후보 ${t.cands.length}곳 — 맞는 단지를 눌러 주세요.</p>${t.cands.map((x, i) => `<button type="button" data-act="cand" data-i="${i}"><b>${esc(x.complexName || x.name)}</b><span>${esc(x.address || '')}</span>${x.suggested ? '<em>비슷한 이름</em>' : ''}</button>`).join('')}</div>`;
  if (t.diag && t.kind === 'warn' && !t.busy) h += `<details class="st-info"><summary>조회 기록 (문제가 계속되면 이 내용을 알려 주세요)</summary><pre>${esc(t.diag)}</pre></details>`;
  if (c.areas.length) h += `<div class="field"><span>실제 현장의 평형(타입)을 골라 주세요 <small>${c.read ? esc(c.read) + ' · ' : ''}<a href="${esc(c.url)}" target="_blank" rel="noopener"${c.url ? '' : ' hidden'}>네이버 출처 보기</a></small></span><div class="chips st-chips">${c.areas.map((a, i) => `<button type="button" class="chip ${areaType(a) === c.type ? 'on' : ''}" data-act="area" data-i="${i}">${esc(areaLabel(a))}<small>${a.supply ? '약 ' + pyOf(a.supply) : ''}</small></button>`).join('')}</div></div>`;
  if (c.type || c.supply) h += `<div class="st-metrics"><div><small>공급면적</small><b>${c.supply ? esc(c.supply) + '㎡' : '-'}</b>${c.supply ? `<span>약 ${pyOf(c.supply)}</span>` : ''}</div><div><small>전용면적</small><b>${c.excl ? esc(c.excl) + '㎡' : '-'}</b>${c.excl ? `<span>약 ${pyOf(c.excl)}</span>` : ''}</div></div><p class="help">㎡·타입은 네이버에서 읽은(또는 직접 넣은) 값이에요. 평 표시는 ㎡에서 환산한 참고값이에요.</p>`;
  h += `<div class="st-step"><b><i>2</i> 도면</b></div>`;
  if (img) h += `<div class="st-plan"><img src="${img}" alt="${esc(c.name)} 도면" data-act="zoom"><small>${esc(c.type || '도면')}${c.planName ? ' · ' + esc(c.planName) : ''} · 눌러서 크게 보기</small></div>`;
  else h += `<div class="st-plan empty"><p>${t.imgs.length ? '아래 그림 중 도면을 눌러 주세요.' : '평형(타입)을 고르면 그 타입의 도면 그림을 가져와요. 안 되면 [도면 파일 넣기]로 파일을 넣거나, 캡처한 도면을 이 칸에 Ctrl+V 하세요.'}</p></div>`;
  if (t.imgs.length > 1) h += `<div class="st-imgs">${t.imgs.map((x, i) => `<button type="button" class="${c.plan === x.url ? 'on' : ''}" data-act="img" data-i="${i}"${dis} title="${esc(x.alt || '네이버 부동산 그림')}"><img src="${esc(x.url)}" alt="" referrerpolicy="no-referrer" loading="lazy"><span>${x.plan ? '도면 ' : ''}${i + 1}</span></button>`).join('')}</div>`;
  h += `<div class="btns"><label class="btn ghost file">도면 파일 넣기<input type="file" data-act="file" accept="image/jpeg,image/png,image/webp"></label>${img ? '<button type="button" class="btn ghost" data-act="rmplan">도면 지우기</button>' : ''}</div>`;
  h += `<details class="st-manual" data-d="read"${t.manualOpen ? ' open' : ''}><summary>자동으로 안 될 때 · 열린 부동산 탭 읽기 / 붙여넣기</summary>
    <div class="btns"><button type="button" class="btn ghost" data-act="find"${hasName ? '' : ' disabled'}>네이버 부동산 열기</button><button type="button" class="btn" data-act="read"${dis}>열려 있는 네이버 부동산 탭에서 읽기</button></div>
    <label class="field">면적 정보 붙여넣기 <small>Ctrl+V 하면 113.67Am² 같은 면적을 찾아요 · 평수만 알면 34A 적고 Enter</small><textarea data-f="paste" rows="2" placeholder="예) 102.23Am²  113.67Am²   또는   34A"></textarea></label>
  </details>
  <details class="st-manual" data-d="typ"><summary>자동으로 안 읽힐 때 · 타입·면적 직접 입력</summary>
    <div class="grid3"><label class="field">타입 직접 입력<input data-m="type" value="${esc(c.man.type || c.type)}" placeholder="예: 84A"></label><label class="field">공급면적 ㎡<input data-m="supply" value="${esc(c.man.supply || c.supply)}" inputmode="decimal"></label><label class="field">전용면적 ㎡<input data-m="excl" value="${esc(c.man.excl || c.excl)}" inputmode="decimal"></label></div>
  </details>`;
  return h;
}
function renderStatus(w) { const el = document.querySelector(`.site-card[data-w="${w}"] [data-st]`); if (!el) return; const st = statusOf(w); el.textContent = st[0]; el.className = 'pill ' + st[1]; }
function renderBody(w) {
  const root = document.querySelector(`.site-card[data-w="${w}"] [data-body]`); if (!root) return;
  const opened = [...root.querySelectorAll('details.st-manual[open]')].map(d => d.dataset.d);
  const ae = document.activeElement && root.contains(document.activeElement) ? document.activeElement : null, active = ae ? ae.getAttribute('data-m') || ae.getAttribute('data-f') || '' : '';
  if (['type', 'supply', 'excl'].includes(active)) { renderStatus(w); return; }   // 직접 입력 중이면 다시 그리지 않아요
  const pv = root.querySelector('[data-f=paste]'), pasteVal = pv ? pv.value : '';
  root.innerHTML = bodyHtml(w); T[w].manualOpen = false;   // [직접 읽기] 칸을 한 번만 자동으로 펼쳐요 (그다음은 사용자가 연 대로)
  for (const k of opened) { const d2 = root.querySelector(`details.st-manual[data-d="${k}"]`); if (d2) d2.open = true; }
  if (pasteVal) { const p2 = root.querySelector('[data-f=paste]'); if (p2) { p2.value = pasteVal; if (active === 'paste') p2.focus(); } }   // 적던 내용은 그대로
  renderStatus(w);
}
function renderCmp() {
  const box = $('siteCmp'); if (!box) return; const x = site();
  box.hidden = !lemon(); if (!lemon()) return;
  const ready = w => !!(T[w].thumb || T[w].full), both = ready('src') && ready('tgt');
  const cmp = x.cmp && x.cmp.sig === sigOf(x) ? x.cmp : null;
  let h = `<div class="st-top"><b>두 현장의 구조 비교</b><small>선택한 타입의 도면을 Claude가 읽고 비교해요 (선택 사항)</small></div>
    <div class="btns"><button type="button" class="btn" data-act="compare"${both ? '' : ' disabled'}>선택한 도면 비교</button></div><div id="siteCmpStatus" class="status" hidden></div>`;
  if (!both) h += '<p class="help">양쪽 현장의 타입을 고르면(또는 도면 파일을 넣으면) 비교할 수 있어요.</p>';
  if (cmp) h += `<p class="st-sum">${esc(cmp.summary)}</p><div class="grid2"><div><h4>공통점</h4><ul>${cmp.similarities.map(s => `<li>${esc(s)}</li>`).join('') || '<li class="muted">-</li>'}</ul></div><div><h4>차이점</h4><ul>${cmp.differences.map(s => `<li>${esc(s)}</li>`).join('') || '<li class="muted">-</li>'}</ul></div></div>`
    + (cmp.unknowns.length ? `<div class="status warn">도면으로 알 수 없는 점: ${cmp.unknowns.map(esc).join(' · ')}</div>` : '')
    + `<label class="check"><input type="checkbox" data-act="reviewed" ${cmp.reviewed ? 'checked' : ''}> 내용을 확인했어요 — 이 비교를 글 작성에 참고해요</label>`;
  const old = box.querySelector('#siteCmpStatus'); const keep = old && !old.hidden ? [old.textContent, old.className] : null;
  box.innerHTML = h; if (keep) { const s = box.querySelector('#siteCmpStatus'); s.hidden = false; s.textContent = keep[0]; s.className = keep[1]; }
}
/* 추천 대상 현장(B)에서 고른 타입·면적 → 레몬 현장 탭의 [추천글 아파트에 맞는 인텍 찾기]가 가져다 써요 */
const typeLetter = t => { const m = /\d(?:\.\d+)?\s*([A-Za-z]{1,2})\s*(?:㎡|m2|m²|타입|형|평)?\s*$/i.exec(String(t || '').trim()); return m ? m[1].toUpperCase() : ''; };
KK.siteTarget = () => {
  const x = KK.state && KK.state.site, c = x && x.tgt; if (!c) return null;
  const man = c.man || {}, type = String(c.type || man.type || '').trim(), sup = parseFloat(c.supply || man.supply), ex = parseFloat(c.excl || man.excl);
  const name = String(c.name || '').trim();
  if (!type && !(sup > 0)) return { name, type: '', letter: '', supply: 0, excl: 0, py: 0 };
  return { name, type, letter: typeLetter(type), supply: sup > 0 ? sup : 0, excl: ex > 0 ? ex : 0, py: sup > 0 ? Math.round(sup / PY * 10) / 10 : 0 };
};
let lastTarget = null;
function emitTarget() {
  const o = KK.siteTarget(), sig = JSON.stringify(o); if (sig === lastTarget) return; lastTarget = sig;
  try { document.dispatchEvent(new CustomEvent('kk:site-target', { detail: o })); } catch (_) {}
}
function renderPill() {
  emitTarget();
  const x = site(), el = $('sitePill'); if (!el) return;
  const parts = WS.filter(visible).map(w => x[w].type ? ROLE[w].badge + ' ' + x[w].type : '').filter(Boolean);
  el.textContent = parts.length ? parts.join(' · ') : '조회 전'; el.className = 'pill' + (parts.length ? ' ok' : '');
}
function renderAll() { for (const w of WS) renderBody(w); renderCmp(); renderPill(); renderHeads(); }

/* 다시 열었을 때: 저장된 도면 미리보기 복원 (없으면 주소로 다시 받아 오기) */
async function restore() {
  if (!lemon()) return;   // 키친앤코: 패널이 숨겨져 있으니 도면 그림을 다시 받아 오지 않는다
  for (const w of WS) {
    const c = site()[w], t = T[w]; if (t.thumb || t.full || !planKey(c) || t.restoring) continue;
    loadThumb(w);
    if (!t.thumb && c.plan) { t.restoring = true; try { await usePlan(w, c.plan); } catch (_) {} t.restoring = false; }
  }
  renderAll();
}

function init() {
  norm();
  const cards = $('siteCards'); cards.innerHTML = WS.map(shell).join('');
  $('siteUse').checked = site().use !== false;
  for (const w of WS) loadThumb(w);
  renderHeads(); renderAll();
  $('siteUse').addEventListener('change', e => { site().use = e.target.checked; persist(); });
  $('sitePanel').addEventListener('toggle', () => { if ($('sitePanel').open) { syncFromBlog(); restore(); } });
  const root = $('sitePanel');
  root.addEventListener('input', e => {
    const card = e.target.closest('.site-card'); if (!card) return; const w = card.dataset.w, c = site()[w];
    const f = e.target.getAttribute('data-f'), m = e.target.getAttribute('data-m');
    if (f === 'name' || f === 'region') {
      c.own = true; setNameRegion(w, f === 'name' ? e.target.value : c.name, f === 'region' ? e.target.value : c.region);
      card.querySelector('[data-sync]').textContent = ''; renderBody(w); renderPill(); persist();
    } else if (m) { c.man[m] = e.target.value; c[m] = e.target.value.trim(); site().cmp = null; renderStatus(w); renderCmp(); renderPill(); persist(); }
  });
  root.addEventListener('change', e => {
    const card = e.target.closest('.site-card'), act = e.target.getAttribute('data-act');
    if (act === 'reviewed') { const x = site(); if (x.cmp) { x.cmp.reviewed = e.target.checked; persist(); } return; }
    if (!card) return; const w = card.dataset.w;
    if (act === 'file') { onFile(w, e.target.files[0]); e.target.value = ''; }
  });
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b || b.tagName === 'SELECT' || b.tagName === 'INPUT') return;
    const act = b.dataset.act, card = b.closest('.site-card'), w = card && card.dataset.w;
    if (act === 'compare') return compare();
    if (!w) return; const c = site()[w], t = T[w];
    if (act === 'auto') autoFind(w);
    else if (act === 'cancel') cancel(w);
    else if (act === 'cand') pickCand(w, +b.dataset.i);
    else if (act === 'read') { t.manualOpen = true; readTab(w); }
    else if (act === 'find') { const q = c.name.trim(); if (q) { window.open('https://new.land.naver.com/search?sk=' + encodeURIComponent(q), '_blank', 'noopener'); t.kind = ''; t.msg = '네이버 부동산에서 단지를 열고, 실제 현장 평형(타입)을 눌러 도면이 보이게 한 뒤 이 화면으로 돌아와 [열려 있는 네이버 부동산 탭에서 읽기]를 누르세요.'; renderBody(w); } }
    else if (act === 'area') { const a = c.areas[+b.dataset.i]; if (a) { if (areaType(a) === c.type) { Object.assign(c, { type: '', supply: '', excl: '', man: { type: '', supply: '', excl: '' } }); site().cmp = null; } else if (c.auto && c.url) { autoType(w, a); return; } else pickArea(w, a); t.msg = ''; t.kind = ''; end(w); } }   // 고른 칩을 다시 누르면 선택 해제 · 자동으로 찾은 단지는 그 타입의 전용면적·도면도 읽어 와요
    else if (act === 'img') importImage(w, +b.dataset.i);
    else if (act === 'rmplan') { c.plan = ''; c.planName = ''; t.full = t.thumb = ''; saveThumb(w); site().cmp = null; end(w); }
    else if (act === 'zoom') zoom(t.full || t.thumb);
  });
  // 면적 글 붙여넣기 / 평수 직접 적고 Enter
  const fromPaste = (w, ta) => { const ok = applyText(w, ta.value, {}); if (ok) ta.value = ''; end(w); return ok; };
  root.addEventListener('paste', e => {
    const card = e.target.closest && e.target.closest('.site-card'); if (!card) return; const w = card.dataset.w;
    const f = [...((e.clipboardData && e.clipboardData.files) || [])].find(x => /^image\//.test(x.type));
    if (f) { e.preventDefault(); onFile(w, f); return; }                                           // 캡처한 도면 그림 붙여넣기
    if (e.target.getAttribute && e.target.getAttribute('data-f') === 'paste') { const ta = e.target; setTimeout(() => fromPaste(w, ta), 0); }
  });
  root.addEventListener('keydown', e => {
    const ta = e.target; if (e.key !== 'Enter' || e.shiftKey || !ta.getAttribute || ta.getAttribute('data-f') !== 'paste') return;
    e.preventDefault(); const card = ta.closest('.site-card'), w = card.dataset.w, c = site()[w], one = KK.landParse.parseManualPy(ta.value);
    if (one) {
      const a = { supply: 0, excl: 0, letter: one.letter || '', py: one.py }; if (!c.areas.some(x => areaType(x) === areaType(a))) c.areas = [...c.areas, a];
      pickArea(w, a); T[w].kind = 'ok'; T[w].msg = areaLabel(a) + '을 넣었어요. 평수만 알아서 ㎡ 값은 비어 있어요 (아래 [직접 입력]에서 넣을 수 있어요).'; ta.value = ''; end(w);
    } else if (ta.value.trim()) fromPaste(w, ta);
  });
  for (const id of ['apt', 'region']) $(id).addEventListener('input', () => setTimeout(syncFromBlog, 0));
  let lastBrand = KK.brandKey;
  const orig = KK.changed; KK.changed = kind => { orig(kind); if (kind === 'typing') return; if (KK.brandKey !== lastBrand) { lastBrand = KK.brandKey; renderAll(); } syncFromBlog(); };
  syncFromBlog();
  if ($('sitePanel').open) restore();
  document.addEventListener('keydown', e => { if (e.key === 'Escape') zoom(''); });
}
function zoom(src) {
  let z = document.getElementById('siteZoom');
  if (!z) { z = document.createElement('div'); z.id = 'siteZoom'; z.className = 'st-zoom'; z.hidden = true; z.innerHTML = '<img alt="도면 크게 보기">'; z.addEventListener('click', () => { z.hidden = true; }); document.body.appendChild(z); }
  if (!src) { z.hidden = true; return; } z.firstChild.src = src; z.hidden = false;
}
KK.siteReset = () => { for (const w of WS) { T[w].seq++; Object.assign(T[w], tmp()); try { localStorage.removeItem(PLAN_KEY(w)); } catch (_) {} } KK.state.site = null; norm(); $('siteUse').checked = true; renderAll(); syncFromBlog(); };
KK.initSite = init;
KK._site = { T, site, readTab, applyText, pickArea, usePlan, compare, syncFromBlog, norm, clearResult, sigOf, autoFind, pickCand, autoType, applyDetails, typeToArea, cancel };
})();
