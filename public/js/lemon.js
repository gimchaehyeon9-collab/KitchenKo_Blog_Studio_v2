/* 레몬하우스 모드
   · 위쪽 [키친앤코 | 레몬하우스] 선택 — 로고·문구·탭이 바뀌어요
   · 레몬 현장 탭: 배포용 폴더에서 '인텍(번호)' 현장 고르기 → 내 블로그 ★번호 폴더로 이동 → 사진 가로 반전 + 레몬하우스 각인 → 컴퓨터에 저장 → 블로그 화면에 넣기
   · 블로그 화면 오른쪽: 글 작성이 끝나면 구글 시트(내 블로그 탭)에 한 줄 기록 */
(() => {
'use strict';
const KK = window.KK;
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toast = (m, k) => KK.toast ? KK.toast(m, k) : alert(m);
const api = async (url, body) => {
  const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const j = await r.json().catch(() => ({ ok: false, error: '서버 응답을 읽지 못했어요.' }));
  if (!j.ok) throw Error(j.error || '요청 실패');
  return j;
};
const loadJson = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (_) { return d; } };
const saveJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };

/* ───────── 레몬하우스 각인 ─────────
   보내 주신 시공 사진을 기준으로 맞췄어요: 가로 폭 약 21%, 오른쪽 아래, 반투명 흰색 */
const LOGO = { width: 0.2131, right: 0.0287, bottom: 0.0415, alpha: 0.58 };   // alpha: 로고 PNG가 이미 50% 반투명이라 .58을 더 곱해 사진 속 각인(약 27%)과 같게
let lemonImg = null;
const loadImage = src => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(Error('사진을 열 수 없어요.')); im.src = src; });
async function lemonLogo() { if (!lemonImg) lemonImg = await loadImage(KK.LEMON_LOGO_PNG); return lemonImg; }
async function drawLemon(ctx, W, H) {
  const L = KK.LEMON_LOGO, img = await lemonLogo();
  const s = (LOGO.width * W) / L.vis;                 // 글자 영역 가로가 사진 가로의 21.3%가 되게
  const w = L.w * s, h = L.h * s;
  const x = W * (1 - LOGO.right) - (L.left + L.vis) * s;
  const y = H - W * LOGO.bottom - (L.top + L.visH) * s;
  ctx.save(); ctx.globalAlpha = LOGO.alpha; ctx.drawImage(img, x, y, w, h); ctx.restore();
}
KK.stampLemon = async (dataUrl) => {
  const img = await loadImage(dataUrl), W = img.naturalWidth, H = img.naturalHeight;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
  await drawLemon(ctx, W, H);
  return c.toDataURL('image/jpeg', .92);
};
const toBlob = (c, q) => new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(Error('사진을 만들지 못했어요.')), 'image/jpeg', q));
/* 사진 한 장: 가로(좌우) 반전한 것 + 반전하고 각인한 것 */
async function flipAndStamp(blob) {
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  try {
    const k = Math.min(1, 4096 / Math.max(bmp.width, bmp.height)), W = Math.round(bmp.width * k), H = Math.round(bmp.height * k);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    ctx.translate(W, 0); ctx.scale(-1, 1); ctx.drawImage(bmp, 0, 0, W, H); ctx.setTransform(1, 0, 0, 1, 0, 0);
    const flipped = await toBlob(c, .96);       // 원본에서 한 번만 다시 저장하는 것이라 높은 화질로
    await drawLemon(ctx, W, H);
    return { flipped, stamped: await toBlob(c, .96) };
  } finally { bmp.close && bmp.close(); }
}
KK._lemon = { flipAndStamp, LOGO, drawLemon };

/* ───────── 브랜드 선택 ───────── */
const BKEY = 'kk-brand';
const LEMON_BRAND = {
  greeting: '안녕하세요, 레몬하우스입니다.\n오늘은 {apt} 아파트 인테리어를 소개해 드리려고 합니다.',
  footer: '레몬하우스 인테리어',
  homepage: ''
};
let KK_BRAND = null, applied = null;      // applied: 지금 화면에 반영된 브랜드
const stash = {};
KK.brandKey = (() => { try { return localStorage.getItem(BKEY) === 'lemon' ? 'lemon' : 'kitchenko'; } catch (_) { return 'kitchenko'; } })();

function applyBrand(key, remember) {
  key = key === 'lemon' ? 'lemon' : 'kitchenko';
  const was = applied || 'kitchenko';
  if (!KK_BRAND) KK_BRAND = { ...KK.BRAND };
  KK.brandKey = key;
  if (remember) { try { localStorage.setItem(BKEY, key); } catch (_) {} }
  const lemon = key === 'lemon';
  document.body.classList.toggle('brand-lemon', lemon);
  document.querySelectorAll('#brandSwitch [data-brand]').forEach(b => b.classList.toggle('on', b.dataset.brand === key));
  $('brandName').textContent = lemon ? 'lemon house' : 'kitchen&ko';
  Object.assign(KK.BRAND, lemon ? LEMON_BRAND : KK_BRAND);
  $('optLogoText').textContent = lemon ? '본문 사진에 레몬하우스 로고 넣기 (오른쪽 아래 · 1:1 대표사진은 로고 없이)' : '본문 사진에 키친앤코 로고 넣기 (1:1 대표사진은 로고 없이)';
  // 기존 글 서식·링크 카드는 키친앤코 글에서 가져온 것이라 레몬하우스 모드에서는 끄고 잠가 둬요 (돌아오면 원래대로)
  const st = $('optStyle'), lk = $('optLink');
  const pl = $('optPlace');   // 레몬 글에는 장소 카드가 없어서 기본은 끔 (원하면 체크)
  if (lemon && was !== 'lemon') { stash.style = st.checked; stash.link = lk.checked; stash.place = pl.checked; st.checked = false; lk.checked = false; pl.checked = false; }
  if (!lemon && was === 'lemon') { if ('style' in stash) st.checked = stash.style; if ('link' in stash) lk.checked = stash.link; if ('place' in stash) pl.checked = stash.place; }
  st.disabled = lk.disabled = lemon;
  // 보이지 않게 된 탭에 있었다면 옮겨요
  const cur = (document.querySelector('.hub-tabs .on') || {}).dataset?.hub;
  if (lemon && (cur === 'sites' || cur === 'insta')) KK.showHub('lemon');
  else if (!lemon && (cur === 'lemon' || cur === 'cafe')) KK.showHub('blog');
  else document.title = lemon ? (cur === 'lemon' ? '레몬하우스 스튜디오 · 현장' : cur === 'cafe' ? '레몬하우스 스튜디오 · 카페 공사전·중' : '레몬하우스 블로그 스튜디오') : document.title.replace(/^레몬하우스/, '키친앤코');
  const first = applied === null; applied = key;
  if (KK.lineSyncMode) KK.lineSyncMode();   // 줄바꿈 방식(이어 쓰기/문장마다)은 브랜드마다 따로 (lines.js)
  if (KK.changed && (was !== key || (first && lemon))) KK.changed('fields');
  if (lemon) { syncRec(); fillTab(); }
}

/* ───────── 레몬 현장 탭 ───────── */
KK.lemonInfo = () => LM;
const LM = { blogs: [], myBlog: '', intek: [], sites: [], mine: [], myFolder: '', q: '', showEmpty: false, busy: false, conn: null, last: loadJson('kk-lemon-last', null) };
const INTEK = ['none', ...Array.from({ length: 13 }, (_, i) => String(i + 1))];
const intekLabel = t => t === 'none' ? '인텍' : '인텍' + t;
const blogLabel = b => b.key === '메인' ? '메인 · ' + b.id : b.key + '번 · ' + b.id;
let sitesTimer = 0, saveTimer = 0;
// 내 블로그가 정해지거나 바뀌면 문체·서식 프로필을 그 번호로 불러와요 (lemon-profile.js)
let announced = null;
function announceBlog() { if (announced === LM.myBlog) return; announced = LM.myBlog; document.dispatchEvent(new CustomEvent('kk-lemon-blog', { detail: { blog: LM.myBlog || '', blogs: LM.blogs } })); }

function renderIntek() {
  $('lmIntek').innerHTML = `<button type="button" class="chip ${LM.intek.length ? '' : 'on'}" data-t="">전체</button>` +
    INTEK.map(t => `<button type="button" class="chip ${LM.intek.includes(t) ? 'on' : ''}" data-t="${t}">${intekLabel(t)}</button>`).join('');
}
function renderBlogSelect() {
  $('lmBlog').innerHTML = '<option value="">— 내 블로그를 골라 주세요 —</option>' + LM.blogs.map(b => `<option value="${esc(b.key)}" ${b.key === LM.myBlog ? 'selected' : ''}>${esc(blogLabel(b))}</option>`).join('');
}
function renderConn() {
  const c = LM.conn, pill = $('lmConn');
  if (!c) { pill.textContent = '확인 중…'; pill.className = 'pill'; return; }
  const ok = c.distOk && c.myFolderOk;
  const sp = $('lmSetPill'); if (sp) { sp.textContent = ok ? '연결됨' : '확인 필요'; sp.className = 'pill ' + (ok ? 'ok' : 'bad'); }
  if (!ok && $('lmSetPanel') && !LM.setTouched) $('lmSetPanel').open = true;   // 연결이 안 됐을 땐 설정 칸을 열어서 바로 보이게
  pill.textContent = !c.distOk ? '배포용 폴더를 못 찾았어요' : !LM.myBlog ? '내 블로그를 골라 주세요' : !c.myFolderOk ? '★번호 폴더를 못 찾았어요' : '연결됨';
  pill.className = 'pill ' + (ok ? 'ok' : '');
  const f = $('lmMyFolder');
  f.textContent = !LM.myBlog ? '-' : c.myFolderOk ? '📁 ' + c.myFolder : '못 찾았어요 — [연결 설정]에서 ★ 폴더들이 있는 위치를 알려 주세요';
  f.className = 'lm-folder ' + (c.myFolderOk ? 'ok' : 'muted');
}
function fillTab() {
  const b = LM.blogs.find(x => x.key === LM.myBlog);
  if ($('lrTab')) $('lrTab').value = b ? b.tab : '';
}
function shortOf(n) { return String(n).replace(/^\s*\([^)]*\)\s*/, '').replace(/^\d{2}\.\s*\d{1,2}\.?\s*(\d{1,2}\.?)?\s*/, '').replace(/\s*인[텍택]\s*\d{0,2}\s*$/, '').trim() || n; }

function rowHtml(r, where) {
  const meta = [r.used && '(X) 표시', r.date, r.pyeong, r.person && '담당 ' + r.person].filter(Boolean).join(' · ');
  const none = r.n === 0;
  const label = where === 'mine' ? '다시 가져오기' : '가져오기';
  return `<tr class="${none ? 'lm-none' : ''}">
    <td class="st-name"><b>${esc(shortOf(r.name))}</b><small>${esc(meta)}</small></td>
    <td><span class="ic ${r.intek === null ? 'hold' : 'left'}">${r.intek === null ? '-' : intekLabel(r.intek === '' ? 'none' : r.intek)}</span></td>
    <td>${none ? '<span class="muted">0장</span>' : (r.n ?? '-') + '장'}</td>
    <td class="st-acts"><button type="button" class="btn ${where === 'mine' ? 'ghost' : 'primary'}" data-pull="${esc(r.name)}" data-where="${where}" ${none || LM.busy ? 'disabled' : ''}>${label}</button></td>
  </tr>`;
}
// 아무것도 안 나올 때: 배포용 폴더에 실제로 있는 인텍 번호와 가장 최근 현장 날짜를 보여 줘요
function availHint() {
  const a = LM.avail || {}, keys = Object.keys(a);
  if (!keys.length) return '';
  keys.sort((x, y) => (x === 'none' ? -1 : y === 'none' ? 1 : x - y));
  const lab = k => k === 'none' ? '번호 없는 인텍' : intekLabel(k);
  const mark = k => LM.intek.includes(k) ? '<b>' + lab(k) + '</b>' : lab(k);
  return '<br><small>지금 배포용 폴더에 있는 번호: ' + keys.map(k => mark(k) + ' ' + a[k] + '곳').join(' · ') + (LM.latest ? '<br>가장 최근 현장: ' + esc(LM.latest) : '') + '</small>';
}
function renderSites() {
  const q = KK.norm ? KK.norm(LM.q) : LM.q.toLowerCase();
  const match = r => !q || (KK.norm ? KK.norm(r.name) : r.name.toLowerCase()).includes(q);
  const list = LM.sites.filter(r => match(r) && (LM.showEmpty || r.n !== 0));
  $('lmCount').textContent = list.length + '곳';
  $('lmBody').innerHTML = list.length ? list.map(r => rowHtml(r, 'dist')).join('')
    : `<tr><td colspan="4" class="st-empty">${LM.err ? esc(LM.err) : '조건에 맞는 현장이 없어요.' + (LM.intek.length ? '<br><small>인텍 번호를 바꾸거나 [전체]를 눌러 보세요.</small>' : '') + availHint()}</td></tr>`;
  const mine = LM.mine.filter(match);
  $('lmMinePanel').hidden = !LM.mine.length;
  $('lmMineCount').textContent = mine.length + '곳';
  $('lmMineBody').innerHTML = mine.map(r => rowHtml(r, 'mine')).join('');
  renderMatch();
}
async function loadSites() {
  $('lmBody').innerHTML = '<tr><td colspan="4" class="st-empty">폴더 읽는 중… (OneDrive가 처음 불러올 때는 조금 걸려요)</td></tr>';
  try {
    const j = await api('/api/lemon/sites?intek=' + encodeURIComponent(LM.intek.join(',')));
    LM.sites = j.sites; LM.mine = j.mine; LM.err = ''; LM.avail = j.avail || {}; LM.latest = j.latest || '';
  } catch (e) { LM.sites = []; LM.mine = []; LM.err = e.message; }
  renderSites();
}
async function loadStatus() {
  try {
    const j = await api('/api/lemon/status');
    LM.conn = j; LM.blogs = j.blogs; LM.myBlog = j.settings.myBlog || ''; LM.intek = j.settings.intek || [];
    $('lmDist').value = j.settings.distRoot || ''; $('lmBlogRoot').value = j.settings.blogRoot || ''; $('lmSave').value = j.settings.saveDir || ''; $('lmSheetUrl').value = j.settings.sheetUrl || '';
    $('lmDist').placeholder = j.settings.autoDist ? '(자동으로 찾았어요) ' + j.settings.distRoot : $('lmDist').placeholder;
    $('lmKeyHint').textContent = j.settings.hasSheetKey ? '저장되어 있어요 · 바꿀 때만 새로 입력' : '스크립트의 KEY와 같게';
    $('lrRetry').hidden = !j.pending;
  } catch (e) { LM.conn = { distOk: false, myFolderOk: false, myFolder: '' }; }
  renderBlogSelect(); renderIntek(); renderConn(); fillTab(); announceBlog();
}
async function saveChoice() { try { await api('/api/lemon/settings', { myBlog: LM.myBlog, intek: LM.intek }); } catch (_) {} }
KK.lemonOpen = async () => { await loadStatus(); loadSites(); syncRec(); };

/* 현장 하나 가져오기: 이동 → 읽기 → 반전+각인 → 저장 → 블로그 화면 */
const STEPS = ['내 블로그 폴더로 이동', '사진 읽기', '가로 반전 + 레몬하우스 각인', '컴퓨터에 저장', '블로그 화면에 넣기'];
function progress(stepStates, note, pct) {
  const mark = { wait: '○', run: '●', ok: '✓', err: '✕', skip: '–' };
  $('lmProg').innerHTML = `<ol>${STEPS.map((t, i) => `<li class="${stepStates[i]}"><span class="m">${mark[stepStates[i]]}</span>${t}</li>`).join('')}</ol>` +
    (pct != null ? `<div class="bar"><i style="width:${Math.round(pct * 100)}%"></i></div>` : '') + (note ? `<div class="${stepStates.includes('err') ? '' : 'muted'}" style="margin-top:4px;word-break:break-all">${esc(note)}</div>` : '');
}
async function pull(name, where) {
  if (LM.busy) return;
  if (!LM.myBlog) return toast('내 블로그를 먼저 골라 주세요.', 'error');
  const row = [...LM.sites, ...LM.mine].find(r => r.name === name);
  if (where === 'dist') {
    if (!LM.conn || !LM.conn.myFolderOk) return toast('내 블로그 ★번호 폴더를 아직 못 찾았어요. [연결 설정]을 확인해 주세요.', 'error');
    if (!confirm('「' + shortOf(name) + '」 폴더를\n레몬하우스 OneDrive의 「' + LM.conn.myFolder + '」 안으로 옮기고,\n사진을 가로 반전 + 각인해서 컴퓨터에 저장할까요?\n\n※ 배포용 폴더에서 이 현장이 사라져요 (다른 사람이 중복으로 가져가지 않도록).' + matchNote(row))) return;
  } else {
    const mn = matchNote(row);
    if (mn.includes('⚠') && !confirm('「' + shortOf(name) + '」 사진을 다시 받을까요?' + mn)) return;
  }
  if (KK.state && KK.state.cards && KK.state.cards.length && !confirm('블로그 화면에 이미 사진이 있어요. 그 뒤에 이어서 넣을까요?\n(새로 시작하려면 [취소] → 블로그 탭의 [새 글 시작]을 먼저 눌러 주세요)')) return;
  LM.busy = true; renderSites();
  const st = STEPS.map(() => 'wait');
  const setS = (i, v, note, pct) => { st[i] = v; progress(st, note, pct); };
  let step = 0;
  try {
    if (where === 'dist') { setS(0, 'run', '폴더를 옮기는 중…'); await api('/api/lemon/claim', { folder: name }); setS(0, 'ok'); }
    else setS(0, 'skip', '이미 내 폴더에 있어요');
    step = 1; setS(1, 'run', '사진 목록 확인 중…');
    const enc = encodeURIComponent(name);
    const { files } = await api('/api/lemon/photos?base=mine&folder=' + enc);
    if (!files.length) throw Error('이 폴더에서 사진을 찾지 못했어요.');
    setS(1, 'ok', files.length + '장');
    const forBlog = [], dir = name; let savedDir = '';
    const w = String(files.length).length < 2 ? 2 : String(files.length).length;
    for (let i = 0; i < files.length; i++) {
      const n = files[i], tag = String(i + 1).padStart(w, '0') + '_' + n.replace(/\.[^.]+$/, '') + '.jpg';
      step = 1; setS(1, 'run', n + ' 읽는 중 (' + (i + 1) + '/' + files.length + ')', i / files.length);
      const r = await fetch('/api/lemon/file?base=mine&folder=' + enc + '&name=' + encodeURIComponent(n));
      if (!r.ok) throw Error(n + ' 사진을 읽지 못했어요.');
      const src = await r.blob();
      step = 2; setS(1, 'ok', null); setS(2, 'run', (i + 1) + '/' + files.length + ' 반전·각인 중…', i / files.length);
      const { flipped, stamped } = await flipAndStamp(src);
      step = 3; setS(2, 'run', null, (i + 1) / files.length); setS(3, 'run', n + ' 저장 중…', i / files.length);
      const up = await fetch('/api/lemon/saveimg?dir=' + encodeURIComponent(dir) + '&name=' + encodeURIComponent(tag), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: stamped });
      const uj = await up.json().catch(() => ({})); if (!uj.ok) throw Error(uj.error || '저장하지 못했어요.');
      savedDir = uj.dir;
      if (forBlog.length < 40) forBlog.push(new File([flipped], tag, { type: 'image/jpeg' }));
    }
    setS(2, 'ok'); setS(3, 'ok', savedDir, 1);
    step = 4; setS(4, 'run', '블로그 화면에 넣는 중…');
    KK.showHub('blog');
    await KK.takeFiles(forBlog, { bring: true });
    let aptSet = false;
    const tApt = targetApt();
    if (tApt && $('apt') && !$('apt').value.trim()) { $('apt').value = tApt; $('apt').dispatchEvent(new Event('input', { bubbles: true })); aptSet = true; }
    setS(4, 'ok', files.length > 40 ? '블로그 화면에는 앞의 40장만 넣었어요.' : null, 1);
    LM.last = { name, at: Date.now(), dir: savedDir }; saveJson('kk-lemon-last', LM.last);
    syncRec(true);
    toast('사진 ' + files.length + '장을 반전·각인해 저장했어요: ' + savedDir + (aptSet ? '\n추천글 아파트명에 「' + targetApt() + '」을 넣어 뒀어요.' : '\n블로그 화면에서 추천글 아파트명을 입력해 주세요.'), 'ok');
  } catch (e) {
    setS(step, 'err', e.message); toast(e.message, 'error');
  } finally { LM.busy = false; loadStatus().then(loadSites); }
}

/* ───────── 현장 고르기 — 쓸 아파트와 평형이 비슷한 인텍을 위에 먼저 보여 줘요 ─────────
   (2.10.37: 예전의 [추천글 아파트에 맞는 인텍 찾기] 칸을 없애고 [현장 고르기]에 합쳤어요.)
   추천글은 '시공 사례'가 아니라서, 쓸 아파트와 평형·구조가 비슷한 인텍 현장의 사진을 골라야 해요.
   쓸 아파트의 평수는 블로그 ① [부동산 찾기]에서 고른 추천 대상 현장(B)의 공급면적(㎡ → 평)을 그대로 써요.
   부동산 찾기를 안 쓸 때는 아래 [평수 직접 입력]에 34 또는 34A 처럼 적으면 돼요. 인텍 폴더 이름의 평수·타입과 견줍니다. */
const PYEONG = 3.3058;
const MKEY = 'kk-lemon-match';
const savedM = loadJson(MKEY, {});
const MATCH = { tol: Math.max(1, Math.min(15, parseFloat(savedM.tol) || 5)), showUsed: !!savedM.showUsed, manual: savedM.manual && savedM.manual.py > 0 ? { py: +savedM.manual.py, letter: String(savedM.manual.letter || '') } : null };
const saveMatch = () => saveJson(MKEY, MATCH);
const { parseManualPy } = KK.landParse;
const siteOf = () => (KK.siteTarget ? KK.siteTarget() : null);
const targetApt = () => { const o = siteOf(); return o && o.name ? o.name : ''; };
// 쓸 아파트의 평수: 부동산 찾기(B)에 공급면적이 있으면 그것, 없으면 직접 입력한 평수
function matchTargets() {
  const o = siteOf();
  if (o && o.py > 0) return [{ py: o.py, letter: o.letter || '', supply: o.supply, excl: o.excl, name: o.name, type: o.type, from: 'site' }];
  if (MATCH.manual) return [{ py: MATCH.manual.py, letter: MATCH.manual.letter, supply: 0, excl: 0, name: o ? o.name : '', type: '', from: 'manual' }];
  return [];
}
const intekOk = r => !LM.intek.length || (r.intek !== null && LM.intek.includes(r.intek === '' ? 'none' : r.intek));
// 후보: 배포용(고른 인텍 번호) + 이미 내 폴더로 가져온 현장(고른 인텍 번호)
function matchPool() {
  const all = (LM.sites || []).filter(r => r.n !== 0).map(r => ({ ...r, where: 'dist' }))
    .concat((LM.mine || []).filter(r => r.n !== 0 && intekOk(r)).map(r => ({ ...r, where: 'mine' })));
  return MATCH.showUsed ? all : all.filter(r => !r.used);   // 이름 앞에 (X) 표시가 붙은 폴더는 이미 쓴 현장
}
// 가까운 순: 평수 차이 − (같은 타입이면 0.7평만큼 가산점)
function rankMatches(targets, pool) {
  const out = [];
  for (const r of pool) {
    if (!r.pyN) continue;
    let best = null;
    for (const t of targets) {
      const diff = Math.abs(r.pyN - t.py), same = !!(t.letter && r.ptype && t.letter[0] === r.ptype[0]), score = diff - (same ? 0.7 : 0);
      if (!best || score < best.score) best = { t, diff, same, score };
    }
    if (best) out.push({ r, ...best });
  }
  return out.sort((a, b) => a.score - b.score || (b.r.date || '').localeCompare(a.r.date || '') || a.r.name.localeCompare(b.r.name, 'ko'));
}
function matchNote(row) {
  const targets = matchTargets(); if (!targets.length || !row || !row.pyN) return '';
  let best = null; for (const t of targets) { const d = Math.abs(row.pyN - t.py); if (!best || d < best.d) best = { d, t }; }
  return best.d > MATCH.tol
    ? '\n\n⚠ 이 현장은 ' + row.pyN + '평이고, 쓸 아파트(' + best.t.py.toFixed(1) + '평)와 ' + best.d.toFixed(1) + '평 차이가 나요 (허용 ±' + MATCH.tol + '평). 구조가 많이 다를 수 있어요.'
    : '\n\n✓ 쓸 아파트와 평형이 비슷해요 (' + row.pyN + '평 ↔ ' + best.t.py.toFixed(1) + '평).';
}
function matchRow(m) {
  const r = m.r, tags = [];
  tags.push(`<span class="lm-tag src">${r.where === 'mine' ? '내 폴더에 있음' : '배포용'}</span>`);
  if (m.same) tags.push(`<span class="lm-tag good">같은 ${esc(m.t.letter)}타입</span>`);
  tags.push(`<span class="lm-tag ${m.diff <= 1.5 ? 'good' : m.diff > MATCH.tol ? 'warn' : ''}">${r.pyN}평${r.ptype ? r.ptype : ''} ↔ ${m.t.py.toFixed(1)}평 · 차이 ${m.diff.toFixed(1)}평</span>`);
  if (r.used) tags.push('<span class="lm-tag warn">(X) 표시 폴더</span>');
  if (/\?$/.test(r.pyeong)) tags.push('<span class="lm-tag warn">평수는 폴더 이름에서 추정</span>');
  const meta = [r.date, r.person && '담당 ' + r.person].filter(Boolean).join(' · ');
  return `<tr>
    <td class="st-name"><b>${esc(shortOf(r.name))}</b><small>${esc(meta)}</small><div>${tags.join('')}</div></td>
    <td><span class="ic left">${intekLabel(r.intek === '' ? 'none' : r.intek)}</span></td>
    <td>${r.n ?? '-'}장</td>
    <td class="st-acts"><button type="button" class="btn ghost" data-prev="1" data-name="${esc(r.name)}" data-where="${r.where}">사진 보기</button>
      <button type="button" class="btn ${r.where === 'mine' ? 'ghost' : 'primary'}" data-pull="${esc(r.name)}" data-where="${r.where}" ${LM.busy ? 'disabled' : ''}>${r.where === 'mine' ? '다시 가져오기' : '가져오기'}</button></td>
  </tr><tr class="lm-prev" hidden><td colspan="4"></td></tr>`;
}
function renderTarget() {
  const el = $('lmTarget'); if (!el) return;
  const o = siteOf(), t = matchTargets()[0], go = '<button type="button" class="linkbtn" data-go="site">부동산 찾기 열기</button>';
  let h = '', k = '';
  if (t && t.from === 'site') { h = '<b>쓸 아파트</b> ' + esc([o.name, o.type, '약 ' + t.py.toFixed(1) + '평'].filter(Boolean).join(' · ')) + ' <span class="muted">— 블로그 ① 부동산 찾기(추천 대상 B)에서 가져왔어요</span> ' + go; k = 'ok'; }
  else if (t) { h = '<b>쓸 아파트</b> ' + esc((o && o.name ? o.name + ' · ' : '') + (t.letter ? t.letter + '타입 ' : '') + t.py + '평') + ' <span class="muted">— 직접 입력</span> <button type="button" class="linkbtn" data-go="clear">지우기</button> ' + go; k = 'ok'; }
  else if (o && o.type) { h = '추천 대상 현장은 타입(' + esc(o.type) + ')만 있고 공급면적이 없어서 평수를 알 수 없어요. 블로그 ① 부동산 찾기에서 평형을 다시 고르거나, 아래에 평수를 직접 적어 주세요. ' + go; k = 'warn'; }
  else { h = '쓸 아파트의 평수를 알면 <b>평형이 비슷한 현장을 아래 목록 맨 위에</b> 먼저 보여 줘요. 블로그 ①의 <b>부동산 찾기</b>에서 추천 대상 현장(B)을 찾거나, 아래에 평수를 직접 적어 주세요. ' + go; }
  el.className = 'lm-target ' + k; el.innerHTML = h;
}
function renderMatch() {
  const out = $('lmMatchOut'); if (!out) return;
  renderTarget();
  const targets = matchTargets(), sum = $('lmMatchSummary'), box = $('lmMatchBox');
  box.hidden = !targets.length;
  if (!targets.length) { sum.textContent = ''; out.innerHTML = ''; return; }
  const where = LM.intek.length ? LM.intek.map(intekLabel).join('·') + ' 안에서' : '전체 인텍에서';
  const ranked = rankMatches(targets, matchPool()), tol = MATCH.tol;
  const inRange = ranked.filter(m => m.diff <= tol), unknown = matchPool().filter(r => !r.pyN).length;
  const usedN = MATCH.showUsed ? 0 : (LM.sites || []).filter(r => r.n !== 0 && r.used && r.pyN).length + (LM.mine || []).filter(r => r.n !== 0 && r.used && r.pyN && intekOk(r)).length;
  const head = (targets[0].name ? targets[0].name + ' · ' : '') + targets.map(t => (t.letter || '') + ' ' + t.py.toFixed(1) + '평').join(' / ') + ' 기준 ±' + tol + '평 · ' + where;
  if (inRange.length) {
    sum.textContent = head + ' — ' + inRange.length + '곳을 찾았어요. 같은 타입이고 평수가 가까운 순서예요.' + (unknown ? ' (평수가 적히지 않은 ' + unknown + '곳은 빠졌어요)' : '') + (usedN ? ' (X) 표시 ' + usedN + '곳은 뺐어요.' : '');
    out.innerHTML = inRange.slice(0, 15).map(matchRow).join('') + (inRange.length > 15 ? `<tr><td colspan="4" class="st-empty">그 밖에 ${inRange.length - 15}곳이 더 있어요. 허용 범위를 줄이면 더 가까운 것만 보여요.</td></tr>` : '');
  } else {
    sum.innerHTML = esc(head) + ' — <b>맞는 인텍이 없어요.</b>' + (ranked.length ? '' : ' (고른 번호 안에 평수가 적힌 현장이 없어요. 인텍 번호를 바꾸거나 [전체]를 눌러 보세요.)');
    out.innerHTML = ranked.length ? `<tr><td colspan="4" class="lm-near">가장 가까운 현장 (평수 차이가 ${tol}평을 넘어서 구조가 다를 수 있어요)</td></tr>` + ranked.slice(0, 5).map(matchRow).join('') : '';
  }
}
async function togglePrev(btn) {
  const tr = btn.closest('tr').nextElementSibling; if (!tr || !tr.classList.contains('lm-prev')) return;
  if (!tr.hidden) { tr.hidden = true; return; }
  tr.hidden = false;
  const cell = tr.firstElementChild; if (cell.dataset.done) return;
  cell.innerHTML = '<span class="muted">사진 불러오는 중… (OneDrive에서 처음 열 때는 조금 걸려요)</span>';
  try {
    const base = btn.dataset.where === 'mine' ? 'mine' : 'dist', enc = encodeURIComponent(btn.dataset.name);
    const j = await api('/api/lemon/photos?base=' + base + '&folder=' + enc);
    const pick = j.files.slice(0, 8);
    cell.innerHTML = pick.length ? pick.map(n => `<img loading="lazy" alt="" src="/api/lemon/file?base=${base}&folder=${enc}&name=${encodeURIComponent(n)}">`).join('') + (j.files.length > pick.length ? `<span class="muted">… 외 ${j.files.length - pick.length}장</span>` : '') : '<span class="muted">사진이 없어요.</span>';
    cell.dataset.done = '1';
  } catch (e) { cell.innerHTML = '<span class="muted">' + esc(e.message) + '</span>'; }
}
function openSiteFinder() {
  KK.showHub('blog'); if (KK.goStep) KK.goStep(1, 'blog');
  const p = $('sitePanel'); if (p) { p.open = true; setTimeout(() => p.scrollIntoView({ block: 'start', behavior: 'smooth' }), 150); }
}
function initMatch() {
  if (!$('lmMatch')) return;
  $('lmMatchTol').value = MATCH.tol; $('lmMatchUsed').checked = MATCH.showUsed;
  $('lmMatchUsed').addEventListener('change', e => { MATCH.showUsed = e.target.checked; saveMatch(); renderMatch(); });
  $('lmMatchTol').addEventListener('input', e => { const v = Math.max(1, Math.min(15, parseFloat(e.target.value) || 5)); MATCH.tol = v; saveMatch(); renderMatch(); });
  const py = $('lmMatchPy');
  const apply = () => {
    const one = parseManualPy(py.value);
    if (one) { MATCH.manual = { py: one.py, letter: one.letter }; saveMatch(); py.value = ''; renderMatch(); toast(one.py + '평' + (one.letter ? ' ' + one.letter + '타입' : '') + ' 기준으로 찾아요.', 'ok'); }
    else if (py.value.trim()) toast('평수를 숫자로 적어 주세요. 예: 34 또는 34A', 'error');
  };
  py.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); apply(); } });
  $('lmMatchPyBtn').addEventListener('click', apply);
  $('lmTarget').addEventListener('click', e => {
    const b = e.target.closest('[data-go]'); if (!b) return;
    if (b.dataset.go === 'clear') { MATCH.manual = null; saveMatch(); renderMatch(); } else openSiteFinder();
  });
  document.addEventListener('kk:site-target', () => renderMatch());   // 블로그 ① 부동산 찾기에서 타입을 고르면 바로 따라와요
  $('lmMatchOut').addEventListener('click', e => {
    const pv = e.target.closest('[data-prev]'); if (pv) return togglePrev(pv);
    const b = e.target.closest('[data-pull]'); if (b) pull(b.dataset.pull, b.dataset.where);
  });
  KK._lemonMatchTest = { parseManualPy, rankMatches, matchNote, matchTargets, renderMatch, MATCH };
  renderMatch();
}

function initLemonTab() {
  $('lmIntek').addEventListener('click', e => {
    const b = e.target.closest('[data-t]'); if (!b) return;
    const t = b.dataset.t;
    LM.intek = !t ? [] : LM.intek.includes(t) ? LM.intek.filter(x => x !== t) : [...LM.intek, t];
    renderIntek(); clearTimeout(sitesTimer); sitesTimer = setTimeout(() => { saveChoice(); loadSites(); }, 250);
  });
  const lsp = $('lmSetPanel'); if (lsp) lsp.addEventListener('toggle', () => { LM.setTouched = true; });
  $('lmBlog').addEventListener('change', async e => { LM.myBlog = e.target.value; await saveChoice(); await loadStatus(); renderSites(); });
  $('lmSearch').addEventListener('input', e => { LM.q = e.target.value; renderSites(); });
  $('lmEmpty').addEventListener('change', e => { LM.showEmpty = e.target.checked; renderSites(); });
  $('lmReload').addEventListener('click', () => { loadStatus().then(loadSites); });
  const click = e => { const b = e.target.closest('[data-pull]'); if (b) pull(b.dataset.pull, b.dataset.where); };
  $('lmBody').addEventListener('click', click); $('lmMineBody').addEventListener('click', click);
  const status = (m, k) => { const el = $('lmSetStatus'); el.hidden = !m; el.textContent = m || ''; el.className = 'status ' + (k || ''); };
  $('lmSaveSet').addEventListener('click', async () => {
    try {
      const body = { distRoot: $('lmDist').value, blogRoot: $('lmBlogRoot').value, saveDir: $('lmSave').value, sheetUrl: $('lmSheetUrl').value };
      if ($('lmSheetKey').value.trim()) body.sheetKey = $('lmSheetKey').value;
      const j = await api('/api/lemon/settings', body); $('lmSheetKey').value = ''; await loadStatus(); loadSites();
      if (j.warn) status('저장은 했지만 시트 연결 주소를 확인해 주세요. ' + j.warn, 'error'); else status('저장했어요.', 'ok');
    } catch (e) { status(e.message, 'error'); }
  });
  $('lmFind').addEventListener('click', async () => {
    try { await api('/api/lemon/settings', { distRoot: '', blogRoot: '' }); await loadStatus(); loadSites(); status($('lmDist').value ? '찾았어요: ' + $('lmDist').value : '자동으로 찾지 못했어요. 폴더 위치를 직접 적어 주세요.', $('lmDist').value ? 'ok' : 'error'); }
    catch (e) { status(e.message, 'error'); }
  });
  $('lmPing').addEventListener('click', async () => {
    status('확인 중…');
    try { const j = await api('/api/lemon/ping'); status('✓ ' + (j.ping || '연결됐어요'), 'ok'); } catch (e) { status(e.message, 'error'); }
  });
}

/* ───────── 글 작성이 끝나면 → 구글 시트 기록 ───────── */
const two = n => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return two(d.getFullYear() % 100) + '.' + two(d.getMonth() + 1) + '.' + two(d.getDate()); };
// 예약 발행을 켜 두었으면 그 예약 날짜가 '포스팅 날짜'예요 (키친앤코 시트 기록에서도 같이 씀)
KK.postDate = () => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(($('optSched') && $('optSched').checked && $('optSchedDate') && $('optSchedDate').value) || '');
  return m ? m[1].slice(2) + '.' + m[2] + '.' + m[3] : today();
};
const dirty = {};
function recDefaults() {
  const apt = ($('apt').value || '').trim(), region = ($('region').value || '').trim();
  let a = apt; try { const k = KK.keywords && KK.keywords(KK.state); if (k && k.A) a = k.A; } catch (_) {}
  return { date: KK.postDate(), site: LM.last ? LM.last.name : '', apt, region: region ? region + ' 추천글' : '', kw: a ? a + ' / ' + a + ' 인테리어' : '' };
}
function syncRec(force) {
  if (!$('lrDate')) return;
  const d = recDefaults();
  const map = { lrDate: d.date, lrSite: d.site, lrApt: d.apt, lrRegion: d.region, lrKw: d.kw };
  for (const [id, v] of Object.entries(map)) if (force ? !(id === 'lrDate' && dirty[id]) : !dirty[id]) { if (force) dirty[id] = false; $(id).value = v; }
  fillTab();
}
function recStatus(m, k) { const el = $('lrStatus'); el.hidden = !m; el.textContent = m || ''; el.className = 'status ' + (k || ''); }
const lemonDone = j => '✓ ' + j.tab + ' 탭 ' + j.row + '행' + (j.mode === 'same' ? '에 이미 같은 글이 적혀 있어서 새 줄은 만들지 않았어요' : j.mode === 'fill' ? '을 채웠어요' : '에 새 줄로 넣었어요') + '.' + (j.kept && j.kept.length ? '\n' + j.kept.join('·') + ' 칸은 시트에 미리 적힌 내용이 있어 그대로 뒀어요' + (j.keptValues ? ' (' + Object.entries(j.keptValues).filter(([k, v]) => j.kept.includes(k) && v).map(([k, v]) => k + ': ' + v).join(' / ') + ')' : '') + '.' : '');
// 레몬하우스 시트 기록 — 손으로 [시트에 기록]을 누를 때와 임시저장 직후 자동 기록이 같이 써요
KK.recordLemon = async auto => {
  if (!LM.myBlog) throw Error('내 블로그를 먼저 골라 주세요. (레몬 현장 탭 위쪽)');
  if (auto) syncRec();
  const j = await api('/api/lemon/sheet', { date: $('lrDate').value, site: $('lrSite').value, apt: $('lrApt').value, region: $('lrRegion').value, keywords: $('lrKw').value, link: $('lrLink') ? $('lrLink').value : '', auto: !!auto });
  $('lrRetry').hidden = true;
  return j;
};
function initRec() {
  ['lrDate', 'lrSite', 'lrApt', 'lrRegion', 'lrKw'].forEach(id => $(id).addEventListener('input', () => { dirty[id] = true; }));
  ['apt', 'region'].forEach(id => $(id).addEventListener('input', () => { if (KK.brandKey === 'lemon') setTimeout(syncRec, 50); }));
  ['optSched', 'optSchedDate'].forEach(id => $(id) && $(id).addEventListener('change', () => { if (KK.brandKey === 'lemon') setTimeout(syncRec, 50); }));
  $('lrSave').addEventListener('click', async () => {
    const btn = $('lrSave');
    btn.disabled = true; recStatus('시트에 기록하는 중…');
    try { recStatus(lemonDone(await KK.recordLemon(false)), 'ok'); }
    catch (e) { recStatus(e.message + (LM.myBlog ? '\n(내용은 대기열에 저장했어요. 연결을 고친 뒤 [못 보낸 것 다시 보내기]를 눌러 주세요)' : ''), 'error'); if (LM.myBlog) $('lrRetry').hidden = false; }
    finally { btn.disabled = false; }
  });
  $('lrCopy').addEventListener('click', async () => {
    await KK.copy([$('lrDate').value, $('lrSite').value, $('lrApt').value, $('lrRegion').value, $('lrKw').value].join('\t'));
    toast('한 줄을 복사했어요. 시트의 해당 줄 첫 칸에 붙여넣기 하세요.', 'ok');
  });
  $('lrRetry').addEventListener('click', async () => {
    try { const j = await api('/api/lemon/retry', {}); recStatus(j.done + '건을 보냈어요' + (j.left ? ' · 못 보낸 것 ' + j.left + '건' : '') + '.', j.left ? 'error' : 'ok'); $('lrRetry').hidden = !j.left; }
    catch (e) { recStatus(e.message, 'error'); }
  });
}
KK.lemonDone = lemonDone; KK.lemonRecStatus = recStatus;

document.addEventListener('DOMContentLoaded', async () => {
  initLemonTab(); initMatch(); initRec();
  $('brandSwitch').addEventListener('click', e => { const b = e.target.closest('[data-brand]'); if (b) applyBrand(b.dataset.brand, true); });
  // 배포용 설정: 기본 브랜드 · 브랜드 고정 (data/lemon-preset.json)
  let preset = {};
  try { const j = await api('/api/lemon/status'); preset = j.preset || {}; LM.blogs = j.blogs; LM.myBlog = j.settings.myBlog || ''; } catch (_) {}
  announceBlog();
  let saved = null; try { saved = localStorage.getItem(BKEY); } catch (_) {}
  let key = preset.lock && preset.brand ? preset.brand : (saved || preset.brand || 'kitchenko');
  if (preset.lock) document.body.classList.add('brand-lock');
  applyBrand(key, !!saved || !!preset.lock);
  const cur = (document.querySelector('.hub-tabs .on') || {}).dataset?.hub;
  if (key === 'lemon' && cur === 'lemon') KK.lemonOpen();
});
})();
