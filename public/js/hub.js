/* 현장 · 인스타 탭 — 블로그 화면(기존 코드)은 건드리지 않고, 위쪽 탭으로 화면만 바꿔 보여 줍니다.
   현장: 개인 엑셀 시트를 읽기만 해서 블로그·인스타 진행 상황을 보여 줌
   인스타: 시공사례 폴더 사진 고르기 → 비율(기본 4:5) 자르기 → Claude 캡션 → 구글 드라이브 폴더에 예약 저장 */
(() => {
'use strict';
const KK = window.KK;
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = async (url, body) => {
  const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const j = await r.json().catch(() => ({ ok: false, error: '응답을 읽지 못했어요.' }));
  if (!j.ok) throw Error(j.error || '요청 실패'); return j;
};
const toast = (m, k) => KK.toast ? KK.toast(m, k) : alert(m);
const ITEM = { A: '주방', B: '붙박이장', C: '신발장', D: '화장대', E: '홈바장', F: '욕실장', G: '하프장', H: '기타장' };
const BLOG_ITEM = { A: 'kitchen', B: 'closet', C: 'entrance', D: 'vanity' };
const shortName = n => String(n || '').replace(/\s*\([^)]*\)\s*\)?\s*$/, '').replace(/^(\d{2}\.\d{1,2}(?:\.\d{1,2})?\.?)\s*/, '$1 ').replace(/(부산광역시|부산시|경상남도|경남|서울특별시)\s*/, '').trim();
const aptGuess = n => {
  const t = String(n || '').replace(/^\s*\d{2}\.\d{1,2}(?:\.\d{1,2})?\.?\s*/, '').replace(/\([^)]*\)/g, ' ');
  const w = t.split(/\s+/).filter(x => x && !/(광역시|특별시|도$|시$|군$|구$|동$|읍$|면$|리$|가$|동\d+가$)/.test(x) && !/^\d/.test(x) && !/_?\d+평/.test(x) && !/^\d+-\d+/.test(x));
  return (w.slice(0, 3).join('').replace(/\d+-\d+.*$/, '').replace(/[_\d]+$/, '').replace(/아파트$/, '')) || '';
};

// 폴더 이름 앞부분("부산광역시 강서구 명지동")에서 지역을 뽑아 먼저 채워 둬요. 네이버 지도 조회가 되면 그 결과로 바뀌어요.
const REG = { '부산광역시': '부산', '부산시': '부산', '대구광역시': '대구', '인천광역시': '인천', '광주광역시': '광주', '대전광역시': '대전', '울산광역시': '울산', '서울특별시': '서울', '서울시': '서울', '경상남도': '경남', '경상북도': '경북', '경기도': '경기', '충청남도': '충남', '충청북도': '충북', '전라남도': '전남', '전라북도': '전북', '강원도': '강원', '제주특별자치도': '제주' };
const regionGuess = n => {
  const t = String(n || '').replace(/^\s*\d{2}\.\d{1,2}(?:\.\d{1,2})?\.?\s*/, '').split(/\s+/), out = [];
  for (const w of t) { if (/^\(|^\d/.test(w)) break; out.push(REG[w] || w); if (/(동|읍|면|리)$/.test(w)) break; if (out.length >= 4) break; }
  return /(동|읍|면|리)$/.test(out[out.length - 1] || '') || out.length >= 2 ? out.join(' ') : '';
};


/* ───────── 블로그 발행 후 시트 기록 ───────── */
const BLOG_CODE = { kitchen: 'A', closet: 'B', dress: 'B', entrance: 'C', vanity: 'D', bath: 'F', living: 'H', study: 'H', laundry: 'H' };
const blogRec = { site: null, letters: new Set(), armed: 0, lastId: '' };
// 블로그 카테고리: 주방(A)이 들어 있으면 '주방가구', 그 밖의 수납 품목이면 '수납장' (품목을 모르면 null = 카테고리 건드리지 않음)
window.KK_blogCategory = () => {
  const fromBlog = new Set((KK.state && KK.state.items || []).map(k => BLOG_CODE[k]).filter(Boolean));
  const L = blogRec.site && blogRec.letters.size ? blogRec.letters : fromBlog;
  if (!L.size) return null;
  return L.has('A') ? '주방가구' : '수납장';
};
function renderBlogRec() {
  const box = $('blogRecSite'); if (!box) return;
  const s = blogRec.site;
  box.textContent = s ? '현장: ' + shortName(s.name) + ' (' + s.tab + ' ' + s.row + '행)' : '현장 탭에서 사진을 보낸 현장이 없어요.';
  $('blogRecItems').innerHTML = s ? Object.entries(ITEM).map(([k, v]) => `<button type="button" class="chip ${blogRec.letters.has(k) ? 'on' : ''}" data-bl="${k}">${v}</button>`).join('') : '';
  $('blogRecSave').disabled = !s || !blogRec.letters.size;
  const cx = $('blogRecCancel'); if (cx) cx.hidden = !blogRec.lastId;
  if (window.KK_sheetSync) window.KK_sheetSync();      // 구글 시트 기록 칸(키친앤코)도 같은 현장·품목으로 맞춰 둬요
}
// 구글 시트(블로그 관리) 기록용 — 현장 탭에서 보낸 현장 이름과 품목(시트에서 쓰는 이름)
const SHEET_ITEM = { A: '주방가구', B: '붙박이장', C: '현관장', D: '화장대', E: '홈바장', F: '욕실장', G: '하프장', H: '제작가구' };
window.KK_blogRecInfo = () => {
  const fromBlog = new Set((KK.state && KK.state.items || []).map(k => BLOG_CODE[k]).filter(Boolean));
  const L = blogRec.site && blogRec.letters.size ? blogRec.letters : fromBlog;
  return { site: blogRec.site ? blogRec.site.name : '', items: Object.keys(SHEET_ITEM).filter(k => L.has(k)).map(k => SHEET_ITEM[k]) };
};
function setBlogRecSite(s) {
  blogRec.site = s; blogRec.armed = Date.now(); blogRec.lastId = '';
  const fromBlog = new Set((KK.state && KK.state.items || []).map(k => BLOG_CODE[k]).filter(Boolean));
  blogRec.letters = fromBlog.size ? fromBlog : new Set(s.items);
  renderBlogRec();
}
function initBlogRec() {
  if (!$('blogRecItems')) return;
  $('blogRecItems').addEventListener('click', e => { const b = e.target.closest('[data-bl]'); if (!b) return; const k = b.dataset.bl; blogRec.letters.has(k) ? blogRec.letters.delete(k) : blogRec.letters.add(k); renderBlogRec(); });
  $('blogRecSave').addEventListener('click', async () => {
    const s = blogRec.site; if (!s) return;
    if (!confirm('네이버에서 발행(또는 예약 발행)을 마쳤나요?\n' + shortName(s.name) + ' · ' + [...blogRec.letters].map(c => ITEM[c]).join(', ') + '\n시트 블로그 칸에 기록해요.')) return;
    $('blogRecSave').disabled = true;
    try {
      const j = await api('/api/insta/blogrecord', { siteName: s.name, sheetTab: s.tab, sheetRow: s.row, items: [...blogRec.letters], apt: $('apt') ? $('apt').value : '' });
      blogRec.armed = 0; blogRec.lastId = j.id;
      setStatus('blogRecStatus', j.dup ? '이미 기록해 둔 요청이에요. 현장 목록에는 바로 반영돼 있고, 시트(E열)는 다음 날 아침 예약 작업이 적어요.' : '기록했어요. 현장 목록에는 바로 반영됐고, 시트(E열)는 다음 날 아침 예약 작업이 적어요.', 'ok');
      sites.loaded && loadSites();
    } catch (e) { setStatus('blogRecStatus', e.message, 'error'); }
    finally { renderBlogRec(); }
  });
  if ($('blogRecCancel')) $('blogRecCancel').addEventListener('click', async () => {
    if (!blogRec.lastId || !confirm('방금 남긴 블로그 기록 요청을 취소할까요?\n(시트에는 적히지 않고, 현장 목록도 원래대로 돌아가요)')) return;
    try {
      await api('/api/insta/recordcancel', { id: blogRec.lastId });
      blogRec.lastId = ''; setStatus('blogRecStatus', '기록 요청을 취소했어요.', 'ok'); sites.loaded && loadSites();
    } catch (e) { setStatus('blogRecStatus', e.message, 'error'); }
    finally { renderBlogRec(); }
  });
}
/* 네이버에 글을 임시저장까지 마치면, 그 현장·품목을 '블로그 올림'으로 자동 기록해요 (사장님이 발행하는 걸 잊어도 목록이 어긋나지 않게).
   현장 탭에서 보낸 사진으로 쓴 글만, 한 번만, 6시간 안에만 기록하고 [기록 취소]로 되돌릴 수 있어요. */
const plainName = t => String(t || '').replace(/[\s.,_\-~·()]/g, '').toLowerCase();
window.KK_blogAutoRecord = async () => {
  const s = blogRec.site, L = [...blogRec.letters];
  if (document.body.classList.contains('brand-lemon')) return '';     // 레몬하우스는 구글 시트로 따로 기록해요
  if (!s || !L.length || !blogRec.armed || Date.now() - blogRec.armed > 6 * 3600e3) return '';
  const a = plainName($('apt') ? $('apt').value : ''), b = plainName(aptGuess(s.name));
  if (a && b && !(a.includes(b) || b.includes(a) || a.slice(0, 2) === b.slice(0, 2))) return '\n\n(아파트명이 보낸 현장과 달라서 시트 기록은 자동으로 하지 않았어요. 필요하면 아래 [발행·예약 완료 → 시트에 기록]을 눌러 주세요)';
  const j = await api('/api/insta/blogrecord', { siteName: s.name, sheetTab: s.tab, sheetRow: s.row, items: L, apt: $('apt') ? $('apt').value : '', auto: true });
  blogRec.armed = 0; blogRec.lastId = j.id; renderBlogRec();
  sites.loaded && loadSites(); loadRecords();
  return '\n\n현장 목록에 "블로그 올림(' + shortName(s.name) + ' · ' + L.map(c => ITEM[c] || c).join(', ') + ')"으로 기록했어요. 시트(E열)는 다음 날 아침 예약 작업이 적어요. 발행을 안 하실 거면 아래 [기록 취소]를 눌러 주세요.';
};

/* ───────── 이미 직접 올린 글 → 시트(데일리) 기록 요청 ─────────
   스튜디오 밖(인스타 앱 등)에서 올린 글은 시트 데일리 칸이 비어 있어 "한 번도 안 올림"으로 보여요.
   여기서 요청을 남기면 구글 드라이브 폴더에 <id>.insta.json 이 생기고, 다음 아침 예약 작업이 엑셀 G열에 적어요. */
const igMark = { id: '', letters: new Set(), records: [] };
const markSites = () => sites.list.filter(s => s.remaining.length && !s.hold).sort((a, b) => siteRank(a) - siteRank(b));
const pendingIg = s => igMark.records.filter(r => r.kind === 'insta' && !r.done && r.siteName === s.name);
function renderMark() {
  const sel = $('igMarkSite'); if (!sel) return;
  if (!sites.loaded || sites.err) {
    sel.innerHTML = `<option value="">${sites.err ? '시트를 읽지 못했어요' : '시트 읽는 중…'}</option>`;
    $('igMarkItems').innerHTML = ''; $('igMarkSave').disabled = true; return;
  }
  const list = markSites();
  if (!list.some(s => s.id === igMark.id)) { igMark.id = ''; igMark.letters.clear(); }
  sel.innerHTML = '<option value="">현장을 고르세요</option>' + list.map(s => `<option value="${esc(s.id)}">${esc(shortName(s.name))} · ${esc(s.tab)}</option>`).join('');
  sel.value = igMark.id;
  const s = list.find(x => x.id === igMark.id);
  for (const k of [...igMark.letters]) if (!s || !s.remaining.includes(k)) igMark.letters.delete(k);
  $('igMarkItems').innerHTML = s ? s.remaining.map(k => `<button type="button" class="chip ${igMark.letters.has(k) ? 'on' : ''}" data-ik="${k}">${ITEM[k] || k}</button>`).join('') : '<span class="muted">현장을 먼저 고르세요.</span>';
  $('igMarkSave').disabled = !s || !igMark.letters.size;
  const pend = igMark.records.filter(r => r.kind === 'insta' && !r.done).length, cnt = $('igMarkCnt');
  cnt.hidden = !pend; cnt.textContent = '대기 ' + pend;
}
function markSelect(s) { igMark.id = s.id; igMark.letters = new Set(); renderMark(); }
async function loadRecords() {
  try { igMark.records = (await api('/api/insta/records')).records; } catch (_) { igMark.records = []; }
  const box = $('igMarkList');
  if (box) box.innerHTML = igMark.records.slice(0, 6).map(r => `<div class="r"><span class="pill ${r.done ? 'done' : 'wait'}">${r.done ? '시트 기록 완료' : '기록 대기'}</span><span class="pill">${r.kind === 'blog' ? '블로그' : '인스타'}${r.auto ? ' · 임시저장 때 자동' : ''}</span><b>${esc(shortName(r.siteName))}</b><span class="muted">${r.items.map(c => ITEM[c] || c).join(', ')}</span>${r.done ? '' : `<button type="button" class="tiny" data-cancel="${esc(r.id)}">취소</button>`}</div>`).join('');
  renderMark(); renderRecs();
}
function initMark() {
  if (!$('igMarkSite')) return;
  $('igMarkSite').addEventListener('change', e => { igMark.id = e.target.value; igMark.letters = new Set(); renderMark(); });
  $('igMarkItems').addEventListener('click', e => { const b = e.target.closest('[data-ik]'); if (!b) return; const k = b.dataset.ik; igMark.letters.has(k) ? igMark.letters.delete(k) : igMark.letters.add(k); renderMark(); });
  $('igMarkSave').addEventListener('click', async () => {
    const s = markSites().find(x => x.id === igMark.id); if (!s || !igMark.letters.size) return;
    const items = [...igMark.letters];
    if (!confirm('인스타에 이미 올린 글이 맞나요?\n' + shortName(s.name) + ' · ' + items.map(c => ITEM[c] || c).join(', ') + '\n다음 아침 예약 작업이 시트 데일리(G열)에 기록해요.')) return;
    $('igMarkSave').disabled = true;
    try {
      const j = await api('/api/insta/instarecord', { siteName: s.name, sheetTab: s.tab, sheetRow: s.row, items, apt: aptGuess(s.name) });
      setStatus('igMarkStatus', j.dup ? '같은 요청이 이미 대기 중이에요.' : '요청을 남겼어요. 다음 아침 예약 작업이 시트 데일리(G열)에 적어요. 엑셀은 닫아 두세요.', 'ok');
      igMark.letters = new Set(); await loadRecords(); loadSites();
    } catch (e) { setStatus('igMarkStatus', e.message, 'error'); }
    finally { renderMark(); }
  });
  $('igMarkList').addEventListener('click', async e => {
    const b = e.target.closest('[data-cancel]'); if (!b) return;
    if (!confirm('이 시트 기록 요청을 취소할까요?\n(시트에는 적히지 않고, 현장 목록도 원래대로 돌아가요)')) return;
    try { await api('/api/insta/recordcancel', { id: b.dataset.cancel }); toast('취소했어요.', 'ok'); await loadRecords(); loadSites(); }
    catch (er) { toast(er.message, 'error'); }
  });
}

/* ───────── 탭 전환 ───────── */
const HUBS = ['sites', 'blog', 'insta', 'lemon', 'cafe'];
function show(tab) {
  if (!HUBS.includes(tab)) tab = 'blog';
  document.querySelectorAll('[data-hub]').forEach(b => b.classList.toggle('on', b.dataset.hub === tab));
  document.querySelector('main.layout').hidden = tab !== 'blog';
  $('hubSites').hidden = tab !== 'sites';
  $('hubInsta').hidden = tab !== 'insta';
  $('hubLemon').hidden = tab !== 'lemon';
  $('hubCafe').hidden = tab !== 'cafe';
  HUBS.forEach(t => document.body.classList.toggle('hub-' + t, t === tab));
  const lm = document.body.classList.contains('brand-lemon');
  document.title = lm ? { lemon: '레몬하우스 스튜디오 · 현장', cafe: '레몬하우스 스튜디오 · 카페 공사전·중', blog: '레몬하우스 블로그 스튜디오' }[tab] || '레몬하우스 블로그 스튜디오'
    : { sites: '키친앤코 스튜디오 · 현장', blog: '키친앤코 블로그 스튜디오', insta: '키친앤코 스튜디오 · 인스타' }[tab] || '키친앤코 블로그 스튜디오';
  try { localStorage.setItem('kk-hub-tab', tab); } catch (_) {}
  if (tab === 'sites') loadSites();     // 탭을 열 때마다 다시 읽어서, 방금 올리거나 기록한 것이 바로 보이게
  if (tab === 'insta') { loadSites(); refreshConn(); loadQueue(); loadRecords(); }
  if (tab === 'lemon' && KK.lemonOpen) KK.lemonOpen();
  if (tab === 'cafe' && KK.cafeOpen) KK.cafeOpen();
  window.scrollTo(0, 0);
}
KK.showHub = show;

/* ───────── 현장 목록 (시트 읽기) ───────── */
const sites = { list: [], loaded: false, filter: 'insta', q: '', tab: 'all', noSeoul: false };
async function loadSites(fresh) {
  const box = $('stBody'); if (box && !sites.loaded) box.innerHTML = '<tr><td colspan="6" class="st-empty">시트 읽는 중…</td></tr>';
  try {
    const j = await api('/api/insta/sites' + (fresh ? '?fresh=1' : ''));
    sites.list = j.sites; sites.loaded = true; sites.err = '';
  } catch (e) { sites.err = e.message; sites.list = []; }
  renderSites(); renderRecs(); renderMark();
}
function siteRank(s) { return (s.queued && s.queued.length ? 2 : 0) * 1e7 + (s.dailyDone.length ? 1 : 0) * 1e7 + (+s.date || 0); }
// 블로그 칸: 끝났으면 ✓, 아니면 올린 품목(파랑)과 남은 품목(주황)을 보여 줘요
function blogCell(s) {
  const pend = s.blogPending || [];
  if (s.blogDone) return '<span class="ok-mark">✓</span>' + (s.blogViaStudioOnly ? ' <span class="ic done pend" title="스튜디오에서 기록한 상태예요. 시트(E열)에는 다음 아침 예약 작업이 적어요">시트 반영 대기</span>' : '');
  if (!s.items.length) return '<span class="muted">-</span>';
  const did = (s.blogCodes || []).filter(c => s.items.includes(c)), left = s.blogRemaining || [];
  return did.map(c => pend.includes(c) ? `<span class="ic done pend" title="스튜디오에서 기록했어요. 시트에는 다음 아침에 적혀요">${ITEM[c] || c} · 반영 대기</span>` : `<span class="ic done">${ITEM[c] || c}</span>`).join('')
    + left.map(c => `<span class="ic left">${ITEM[c] || c} 남음</span>`).join('') || '<span class="muted">-</span>';
}
function renderSites() {
  const body = $('stBody'); if (!body) return;
  if (sites.err) { body.innerHTML = `<tr><td colspan="6" class="st-empty">${esc(sites.err)}<br><small>인스타 탭 [예약] 단계의 [연결 설정]에서 시트 위치를 확인해 주세요.</small></td></tr>`; return; }
  const q = KK.norm ? KK.norm(sites.q) : sites.q;
  let list = sites.list.filter(s => (sites.tab === 'all' || s.tab === sites.tab) && (!q || (KK.norm ? KK.norm(s.name) : s.name).includes(q)));
  if (sites.filter === 'insta') list = list.filter(s => s.remaining.length && !s.hold);
  if (sites.filter === 'blog') list = list.filter(s => !s.blogDone);
  if (sites.filter === 'seoul') list = list.filter(s => s.seoul);
  if (sites.noSeoul && sites.filter !== 'seoul') list = list.filter(s => !s.seoul);   // 서울 현장 제외하고 보기
  $('stCount').textContent = list.length + '곳';
  if (!list.length) { body.innerHTML = '<tr><td colspan="6" class="st-empty">조건에 맞는 현장이 없어요.</td></tr>'; return; }
  body.innerHTML = list.map(s => `<tr>
    <td class="st-name"><b>${esc(shortName(s.name))}</b><small>${esc(s.tab)} · ${s.row}행</small></td>
    <td>${s.items.map(c => `<button type="button" class="ic pick" data-item="${c}" data-id="${esc(s.id)}" title="${ITEM[c] || c} 사진 보기">${ITEM[c] || c}</button>`).join('') || '<span class="muted">-</span>'}${s.seoul ? '<span class="ic seoul">서울</span>' : ''}</td>
    <td>${blogCell(s)}</td>
    <td>${s.hold ? '<span class="ic hold">보류</span>' : ''}${s.dailyDone.map(c => (s.dailyPending || []).includes(c) ? `<span class="ic done pend" title="스튜디오는 올린 걸 알고 있어요. 시트에는 다음 아침 예약 작업이 적어요">${ITEM[c] || c} · 시트 반영 대기</span>` : `<span class="ic done">${ITEM[c] || c}</span>`).join('')}${(s.excluded || []).map(c => `<span class="ic hold">${ITEM[c] || c} 제외</span>`).join('')}${s.remaining.map(c => { const q = (s.queued || []).includes(c); return `<button type="button" class="ic ${q ? 'queued' : 'left'} pick" data-item="${c}" data-id="${esc(s.id)}" title="${ITEM[c] || c} 사진 보기${q ? ' (이미 예약해 둔 품목이에요)' : ''}">${ITEM[c] || c} ${q ? '예약중' : '남음'}</button>`; }).join('')}${s.instaDone ? ' <span class="ok-mark">✓</span>' : ''}</td>
    <td>${s.folder ? `<button type="button" class="ic pick all" data-allph data-id="${esc(s.id)}" title="이 현장 사진을 전부 보고, 직접 골라서 블로그·인스타에 써요">${s.photoCount}장 · 전체 보기</button>` : '<span class="muted">폴더 없음</span>'}</td>
    <td class="st-acts">${s.folder ? `<button type="button" class="btn ghost" data-act="insta" data-id="${esc(s.id)}">인스타 만들기</button> <button type="button" class="btn ghost" data-act="blog" data-id="${esc(s.id)}">블로그로 사진</button>` : ''}</td>
  </tr>`).join('');
}
function initSites() {
  $('stBody').addEventListener('click', e => {
    const ap = e.target.closest('[data-allph]');
    if (ap) { const s1 = sites.list.find(x => x.id === ap.dataset.id); if (s1 && s1.folder) openPhotos(s1, {}); return; }
    const ch = e.target.closest('[data-item]');
    if (ch) { const s0 = sites.list.find(x => x.id === ch.dataset.id); if (s0 && s0.folder) openItemPhotos(s0, ch.dataset.item); else toast('이 현장은 사진 폴더를 찾지 못했어요.', 'error'); return; }
    const b = e.target.closest('[data-act]'); if (!b) return;
    const s = sites.list.find(x => x.id === b.dataset.id); if (!s) return;
    if (b.dataset.act === 'insta') { show('insta'); openSite(s); }
    if (b.dataset.act === 'blog') sendToBlog(s, null, b);
  });
  try { sites.noSeoul = localStorage.getItem('kk-no-seoul') === '1'; } catch (_) {}
  const syncNoSeoul = () => { $('stNoSeoul').checked = !!sites.noSeoul; $('stNoSeoulBox').classList.toggle('on', !!sites.noSeoul && sites.filter !== 'seoul'); $('stNoSeoulBox').classList.toggle('dis', sites.filter === 'seoul'); };
  syncNoSeoul();
  $('stNoSeoul').addEventListener('change', e => { sites.noSeoul = e.target.checked; try { localStorage.setItem('kk-no-seoul', sites.noSeoul ? '1' : '0'); } catch (_) {} syncNoSeoul(); renderSites(); });
  $('stSeg').addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (!b) return; sites.filter = b.dataset.f; $('stSeg').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); syncNoSeoul(); renderSites(); });
  $('stTab').addEventListener('change', e => { sites.tab = e.target.value; renderSites(); });
  $('stSearch').addEventListener('input', e => { sites.q = e.target.value; renderSites(); });
  $('stReload').addEventListener('click', () => loadSites(true));
}

/* 현장 사진 보기 — 품목 칩을 누르면 그 품목 사진부터, [전체 보기]를 누르면 모든 사진을 보여 줘요.
   시트의 품목 분류는 틀릴 수 있어서, 어느 화면에서든 [전체]로 바꿔 모든 사진 중에서 직접 고를 수 있어요. */
const itemLabel = cs => cs.map(c => ITEM[c] || c).join('·');
async function loadThumbs(root, folder) {
  const imgs = [...root.querySelectorAll('img[data-src]')];
  for (const im of imgs) { if (!im.isConnected) return; try { im.src = await thumbOf(folder, im.dataset.src); } catch (_) {} }
}
async function openPhotos(s, o = {}) {
  let m = $('itemModal');
  if (!m) { m = document.createElement('div'); m.id = 'itemModal'; m.className = 'item-modal'; document.body.appendChild(m); m.addEventListener('click', ev => { if (ev.target === m) m.hidden = true; }); }
  m.hidden = false; m.innerHTML = '<div class="im-box"><p class="muted">사진 읽는 중…</p></div>';
  try {
    const all = (await api('/api/insta/photos?folder=' + encodeURIComponent(s.folder))).files;
    const notes = s.notes || {};
    const inCode = (c, f) => !!(notes[c] && notes[c].files.includes(base(f)));
    const codes = Object.keys(notes).filter(c => all.some(f => inCode(c, f)));
    const codesOfFile = f => codes.filter(c => inCode(c, f));
    const unclassified = all.filter(f => !codesOfFile(f).length);
    const isStar = (f, only) => (only ? [only] : codes).some(c => isPick({ picks: new Set(notes[c].picks || []) }, f));
    let flt = o.code && codes.includes(o.code) ? o.code : 'all';   // 'all' = 전체, '_' = 분류 안 된 사진, 그 밖엔 품목 코드
    const sel = new Set(flt !== 'all' ? all.filter(f => inCode(flt, f)) : []);   // 품목 칩으로 열면 그 품목 사진을 미리 골라 둠
    let touched = false, lastI = -1, vis = all;
    const visible = () => flt === 'all' ? all : flt === '_' ? unclassified : all.filter(f => inCode(flt, f));
    const cnt = (list) => list.length + '장';
    const draw = () => {
      vis = visible();
      const chips = [`<button type="button" class="chip ${flt === 'all' ? 'on' : ''}" data-flt="all">전체 <small>${cnt(all)}</small></button>`]
        .concat(codes.map(c => `<button type="button" class="chip ${flt === c ? 'on' : ''}" data-flt="${c}">${ITEM[c] || c} <small>${cnt(all.filter(f => inCode(c, f)))}</small></button>`))
        .concat(unclassified.length && codes.length ? [`<button type="button" class="chip ${flt === '_' ? 'on' : ''}" data-flt="_">분류 안 됨 <small>${cnt(unclassified)}</small></button>`] : []);
      const only = flt !== 'all' && flt !== '_' ? flt : '';
      m.innerHTML = `<div class="im-box"><div class="im-h"><b>${esc(shortName(s.name))}</b><span class="pill" data-cnt></span><button type="button" class="tiny" data-x>닫기</button></div>
        <p class="help">${codes.length ? '시트의 품목 분류는 틀릴 수 있어요. <b>전체</b>를 눌러 모든 사진 중에서 직접 골라 쓰세요. 사진 위 작은 글자는 분류된 품목이에요.' : '이 현장은 사진정리 탭에 품목 분류가 없어요. 쓸 사진을 직접 눌러 고르세요.'} (Shift+클릭: 구간 선택)</p>
        ${codes.length ? `<div class="im-flt">${chips.join('')}</div>` : ''}
        <div class="pgrid">${vis.map(f => { const cs = codesOfFile(f); return `<button type="button" class="pk ${sel.has(f) ? 'on' : ''}" data-f="${esc(f)}" title="${esc(f)}"><img alt="" data-src="${esc(f)}"><span class="o">✓</span>${isStar(f, only) ? '<span class="star">★</span>' : ''}${flt === 'all' && cs.length ? `<span class="it">${esc(itemLabel(cs))}</span>` : ''}</button>`; }).join('') || '<p class="muted">이 분류에는 사진이 없어요.</p>'}</div>
        <div class="im-bar btns"><button type="button" class="btn primary" data-blog></button><button type="button" class="btn ghost" data-insta>선택한 사진으로 인스타 만들기</button><button type="button" class="btn ghost" data-all></button><button type="button" class="btn ghost" data-none>선택 비우기</button></div></div>`;
      paint(); loadThumbs(m, s.folder);
    };
    const paint = () => {
      m.querySelectorAll('.pk').forEach(b => b.classList.toggle('on', sel.has(b.dataset.f)));
      const pill = m.querySelector('[data-cnt]'); if (pill) pill.textContent = sel.size + '장 선택 · 전체 ' + all.length + '장';
      const bl = m.querySelector('[data-blog]'); if (bl) { bl.textContent = sel.size ? `선택한 ${sel.size}장 블로그로 보내기` : '사진을 골라 주세요'; bl.disabled = !sel.size; }
      const ins = m.querySelector('[data-insta]'); if (ins) ins.disabled = !sel.size;
      const al = m.querySelector('[data-all]'); if (al) al.textContent = vis.length && vis.every(f => sel.has(f)) ? '이 목록 모두 해제' : '이 목록 모두 선택';
    };
    draw();
    m.onclick = async ev => {
      if (ev.target === m || ev.target.closest('[data-x]')) { m.hidden = true; return; }
      const fl = ev.target.closest('[data-flt]');
      if (fl) { flt = fl.dataset.flt; lastI = -1; return draw(); }   // 고른 사진은 그대로 두고 보는 목록만 바꿔요
      const pk = ev.target.closest('[data-f]');
      if (pk) {
        const f = pk.dataset.f, i = vis.indexOf(f); touched = true;
        if (ev.shiftKey && lastI >= 0) { const [a, z] = [Math.min(lastI, i), Math.max(lastI, i)], on = !sel.has(f); for (let k = a; k <= z; k++) on ? sel.add(vis[k]) : sel.delete(vis[k]); }
        else sel.has(f) ? sel.delete(f) : sel.add(f);
        lastI = i; window.getSelection && window.getSelection().removeAllRanges(); return paint();   // 화면을 다시 그리지 않아서 스크롤 위치가 그대로예요
      }
      if (ev.target.closest('[data-all]')) { touched = true; if (vis.every(f => sel.has(f))) vis.forEach(f => sel.delete(f)); else vis.forEach(f => sel.add(f)); return paint(); }
      if (ev.target.closest('[data-none]')) { touched = true; sel.clear(); return paint(); }
      const chosen = () => all.filter(f => sel.has(f));   // 파일 순서대로
      if (ev.target.closest('[data-blog]')) { if (!sel.size) return; m.hidden = true; return sendToBlog(s, chosen(), null); }
      if (ev.target.closest('[data-insta]')) {
        if (!sel.size) return;
        const code = (flt !== 'all' && flt !== '_') ? flt : (o.code && codes.includes(o.code) ? o.code : '');
        let list = chosen();
        if (!touched) { const st = list.filter(f => isStar(f, code)); if (st.length) list = st; }   // 안 건드렸으면 ★ 추천 사진만
        if (list.length > 10) toast('인스타는 사진 10장까지예요. 앞의 10장만 담았어요.', 'error');
        m.hidden = true; show('insta'); await openSite(s);
        IG.picked = list.slice(0, 10);
        const it = code || o.code || s.remaining[0] || '';
        IG.items = new Set(it ? [it] : []); renderItems(); renderPicker(); syncCrops();
        $('igMemo').value = it ? ITEM[it] + ' 위주' : '';
      }
    };
  } catch (e) { m.innerHTML = `<div class="im-box"><p class="muted">${esc(e.message)}</p><button type="button" class="tiny" onclick="this.closest('.item-modal').hidden=true">닫기</button></div>`; }
}
const openItemPhotos = (s, code) => openPhotos(s, { code });

/* 블로그 탭으로 사진 보내기 — 블로그 화면의 기존 '사진 넣기'를 그대로 사용 */
async function sendToBlog(s, names, btn) {
  if (!KK.takeFiles) return toast('블로그 화면이 아직 준비되지 않았어요.', 'error');
  try {
    if (btn) { btn.disabled = true; btn.textContent = '사진 가져오는 중…'; }
    const files = names || (await api('/api/insta/photos?folder=' + encodeURIComponent(s.folder))).files;
    if (KK.state && KK.state.cards && KK.state.cards.length && !confirm('블로그 화면에 이미 사진이 있어요. 그 뒤에 이어서 넣을까요?\n(새로 시작하려면 [취소] → 블로그 탭의 [새 글 시작]을 먼저 눌러 주세요)')) return;
    // 영상 만들 때 쓰도록 이 사진들을 컴퓨터 폴더에도 복사해 둬요
    let saved = null; try { saved = await api('/api/insta/export', { folder: s.folder, names: files, label: shortName(s.name) }); } catch (e) { toast('영상용 사진 저장 실패: ' + e.message, 'error'); }
    const list = [];
    for (const n of files.slice(0, 40)) {
      const r = await fetch('/api/insta/file?folder=' + encodeURIComponent(s.folder) + '&name=' + encodeURIComponent(n));
      if (r.ok) list.push(new File([await r.blob()], n, { type: r.headers.get('content-type') || 'image/jpeg' }));
    }
    show('blog');
    // 현장을 바꿔 보내면 아파트명·지역도 그 현장 것으로 바꿔요 (같은 현장을 이어 넣을 땐 그대로)
    const apt = $('apt'), reg = $('region');
    if (apt && (KK.lastSiteId !== s.id || !apt.value.trim())) {
      apt.value = aptGuess(s.name); apt.dispatchEvent(new Event('input', { bubbles: true }));
      if (reg) { reg.value = regionGuess(s.name); reg.dispatchEvent(new Event('input', { bubbles: true })); reg.dataset.auto = '1'; }
    }
    KK.lastSiteId = s.id; setBlogRecSite(s);
    await KK.takeFiles(list, { bring: true });
    if (saved && saved.failed && saved.failed.length) toast('영상용 사진 ' + saved.total + '장 중 ' + saved.count + '장만 저장했어요. 못 받은 사진: ' + saved.failed.slice(0, 3).join(', ') + (saved.failed.length > 3 ? ' 외 ' + (saved.failed.length - 3) + '장' : '') + '\n폴더: ' + saved.dir, 'error');
    else if (saved && saved.count) toast('영상용으로 사진 ' + saved.count + '장을 컴퓨터에 저장했어요: ' + saved.dir, 'ok');
    if (files.length > 40) toast('블로그에는 사진을 40장까지 넣을 수 있어 앞의 40장만 넣었어요.', 'error');
  } catch (e) { toast(e.message, 'error'); }
  finally { if (btn) { btn.disabled = false; btn.textContent = '블로그로 사진'; } }
}

/* ───────── 인스타 ───────── */
const FOOTER = '▫ showroom | 부산시 수영구 수영로 449, 2층\n▫ 방문예약 | 1833-8504';
const TONES = ['화이트', '아이보리', '크림', '웜톤', '베이지', '그레이지', '웜그레이', '연그레이', '그레이', '밝은 우드', '짙은 우드', '다크 컬러'];
const SEED = [
  '은은한 베이지 컬러의 주방가구에 자연스러운 스톤 질감의 상판을 더해 우아하고 차분한 분위기를 완성했습니다. 아일랜드와 연결된 테이블은 조화로운 디자인을 이루며, 조리와 식사가 자연스럽게 이어지는 공간으로 구성했습니다.',
  '짙은 우드 패턴의 제작가구를 벽면 전체에 구성해 고급스러운 분위기를 완성했습니다. 간접조명을 더한 싱크대와 유리 도어 수납장, 냉장고장을 일체감 있게 배치해 세련되고 정돈된 공간을 연출했습니다.',
  '차분한 그레이 컬러의 현관장을 천장까지 구성해 깔끔하고 세련된 공간을 완성했습니다. 중앙에는 따뜻한 우드 소재의 오픈장을 배치하고 은은한 간접조명을 더해, 실용적인 수납과 감각적인 디자인을 함께 담아냈습니다.',
  '벽면을 따라 천장까지 이어지는 화이트 현관장은 간결한 도어 디자인으로 단정하고 세련된 분위기를 완성합니다. 넉넉한 수납공간으로 실용성을 확보하고, 하부에 더한 은은한 간접조명으로 가구의 깔끔한 실루엣을 한층 돋보이게 했습니다.',
  '차분한 그레이 컬러와 화이트 상판이 조화를 이루는 주방으로, 간결한 디자인이 세련된 분위기를 자아냅니다. 벽면을 따라 이어지는 수납장과 ㄱ자형 조리대, 은은한 간접조명이 어우러져 절제된 아름다움과 실용성을 함께 담아냈습니다.',
  '벽면을 따라 길게 이어지는 와이드 화장대와 대형 거울을 일체감 있게 구성해 한층 여유롭고 고급스러운 공간을 완성했습니다. 은은한 조명과 오크 톤의 섬세한 우드결이 어우러져 호텔 파우더룸을 연상시키는 세련된 무드를 더합니다.',
  '화이트를 중심으로 정돈한 주방에 넓은 아일랜드와 벽면 수납을 함께 구성해 군더더기 없는 인상을 완성했습니다. 여기에 월넛 컬러의 오픈장을 포인트로 더해 단정한 공간에 따뜻한 무게감을 주고, 다양한 간접조명이 가구의 선과 공간의 흐름을 한층 세련되게 보여줍니다.'
];
const RULES = `너는 부산의 프리미엄 맞춤 제작가구 브랜드 "키친앤코"의 인스타그램 담당이다. 키친앤코는 인테리어 시공사가 아니라 맞춤가구(제작가구) 브랜드다.
첨부한 현장 사진을 보고 인스타 본문을 쓴다.

[형식]
- 본문은 정확히 2문장. 한 문장이 너무 길지 않게, 전체 120~170자 정도.
- 존댓말 "~완성했습니다 / ~담아냈습니다 / ~더했습니다 / ~연출했습니다" 계열로 끝낸다. "~한다"체 금지.
- 해시태그, 주소, 이모지, 따옴표, 번호, 볼드는 본문에 넣지 않는다.

[내용]
- 가구 중심으로 쓴다. 중문, 타일, 벽지, 바닥, 창, 자연광, 소품 설명은 넣지 않는다(메모에서 요청한 경우만).
- 사진에서 확인되는 것만 쓴다. 보이지 않는 자재, 하드웨어, 기능, 동선 효율을 추측하지 않는다.
- 첫 문장은 컬러/소재와 전체 가구 구성, 두 번째 문장은 포인트 디테일(오픈장, 간접조명, 유리 도어, 상판 질감 등)과 그 효과.
- 고급스럽고 절제된 프리미엄 브랜드 문체. 과장된 홍보 문구 금지.

[색상 — 가장 많이 틀린 부분]
- 사진 조명(전구색) 때문에 색이 달라 보인다. 확신 없으면 "화이트"로 단정하지 말고 아이보리, 크림, 웜톤, 그레이지, 웜그레이, 연그레이 중 실제에 가까운 말을 쓰거나 "웜한 톤", "은은한 톤"처럼 쓴다.
- 사장님이 컬러를 지정하면 무조건 그 컬러를 쓴다.
- 어두운 색은 "차분한 다크 컬러", "짙은 우드", "깊이감 있는" 등으로 쓴다.

[가구 명칭 — 현장 용어]
- 쓰는 말: 현관장, 하프장, 벤치장, 오픈 벤치장, 오픈장, 키큰장, 냉장고장, 밥솥장, 홈카페장, 홈바장, 싱크대, 아일랜드, 상·하부장, 붙박이장, 드레스룸, 화장대, 스타일러장, 월플렉스, 슬라이드장, 윈도우 시트, 유리 진열장, 팬트리장, 빌트인장.
- 자주 틀림: 물이 있으면 홈바장이 아니라 싱크대. 큰 빈 칸이 냉장고 자리면 스타일러장이 아니라 냉장고장. "시스템장" 대신 "빌트인장/맞춤 수납장".
- 주방 형태(ㄱ자/ㄷ자/일자/대면형)는 확실할 때만 쓴다.

[키친앤코 문체의 특징 — 사장님이 직접 고쳐 확정한 글들에서 뽑았다]
- 첫 문장: "[컬러] 톤의 [가구]를 [벽면/천장까지·일체감 있게] 구성해 [정돈된·세련된·안정감 있는] 분위기를 완성했습니다."
- 둘째 문장: 포인트(우드 오픈장, 은은한 간접조명, 유리 진열장, 상판)를 "더해/어우러져" 쓰고, 실용성·완성도를 "높였습니다/담아냈습니다/연출했습니다"로 맺는다.
- 어휘는 담백하고 단정하게: 일체감 있게, 군더더기 없는, 간결한 도어 디자인, 은은한 간접조명, 정돈된, 차분한, 절제된, 세련된, 우드 포인트. 감탄·광고 문구·과한 수식은 쓰지 않는다.
- 한 문장 안에서 가구 → 구성 방식 → 분위기 순서로 흐르게 쓰고, 같은 표현(예: "깊이감 있는", "고급스러운")을 한 글에서 두 번 쓰지 않는다.
- 명사로 끝나는 문장("~한 주방 공간.") 말고 반드시 "~했습니다/~더했습니다" 문장으로 끝낸다.

[쓰지 말 표현]
품격, 풍부한 질감, 매립감 있게, 오픈 니치, 슬림 인출장, 인출식, 그리드 타일, 한켠에, 사이로, 넉넉한 규모, 담백한 하얀색, 음침, 칙칙, 우중충, 공간을 깨끗하게, 생활 동선이 효율적으로 설계, 도어 세트, 중성 톤, 뉴트럴(남발 금지, 쓰더라도 한 번), 제품 사양명(예: 플레인K).`;

KK.igInfo = () => IG;
const IG = { site: null, files: [], groups: null, picked: [], crops: [], tones: new Set(), items: new Set(), options: [], pick: -1, feedback: [], memory: { confirmed: [], feedback: [] }, queue: [], job: null, ready: {}, ratio: '4:5', pvKey: '', flat: false };
const tagOf = a => '#' + String(a || '').replace(/\s+/g, '');

/* 인테리어 업체 태그 — 레몬하우스가 아닌 업체가 공사한 현장 (캡션에 'Interior designed by @계정' 줄) */
const handleOf = v => {
  let t = String(v || '').trim(); if (!t) return '';
  const m = /instagram\.com\/([A-Za-z0-9._]+)/i.exec(t); if (m) t = m[1];
  t = t.replace(/^@+/, '').replace(/\s+/g, '');
  return t ? '@' + t : '';
};
// 현장명 괄호가 '(담당자_업체명)' 모양이면 타 업체 현장으로 봅니다. 예: (홍수진_클레버인테리어)
const companyOf = name => { const m = /\(([^()]*?)_([^()]+)\)/.exec(String(name || '')); return m ? { person: m[1].trim(), company: m[2].trim() } : null; };
const IMAP_KEY = 'kk-interior-map';
const interiorMap = () => { try { return JSON.parse(localStorage.getItem(IMAP_KEY) || '{}'); } catch (_) { return {}; } };
const rememberInterior = (company, handle) => { if (!company || !handle) return; try { const m = interiorMap(); m[company] = handle; localStorage.setItem(IMAP_KEY, JSON.stringify(m)); } catch (_) {} };
const interiorLine = () => { const h = handleOf($('igInterior').value); return h ? 'Interior designed by ' + h : ''; };
const creditBlock = () => [interiorLine(), $('igCredit').value.trim()].filter(Boolean).join('\n');
function fillInterior(s) {
  const co = companyOf(s && s.name); IG.company = co ? co.company : '';
  $('igInterior').value = co ? (interiorMap()[co.company] || '') : '';
  $('igInteriorHint').textContent = co ? co.company + ' 공사 현장이에요 — ' + ($('igInterior').value ? '지난번 계정을 넣어 뒀어요' : '인스타 계정을 넣어 주세요') : '레몬하우스가 아닌 업체가 공사했을 때만';
}
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fmtD = s => { const d = new Date(s + 'T00:00'); return `${d.getMonth() + 1}월 ${d.getDate()}일(${'일월화수목금토'[d.getDay()]})`; };
function nextFreeDay() {
  const taken = new Set(IG.queue.filter(p => p.status !== '게시 완료').map(p => p.scheduledDate));
  const d = new Date(); if (d.getHours() >= 9) d.setDate(d.getDate() + 1);
  for (let i = 0; i < 90; i++) { const w = d.getDay(); if (w > 0 && w < 6 && !taken.has(ymd(d))) return ymd(d); d.setDate(d.getDate() + 1); }
  return ymd(d);
}

/* 연결 상태 */
function showFire(f) {
  const el = $('setFireState'); if (!el) return;
  const l = f && f.last, t = l ? new Date(l.at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '';
  el.textContent = !f || !f.on ? '아직 설정 안 됨 — 지금은 매시 5분에 확인해서 올려요.' : '설정됨 — [지금 바로 발행]을 누르면 1분쯤 뒤 바로 시작해요.' + (l ? ' 마지막: ' + l.id + ' · ' + l.state + ' (' + t + ')' + (l.why ? ' — ' + l.why : '') : '');
  el.className = "hint" + (f && f.on && !(l && l.ok === false) ? "" : " warn-t");
}
async function refreshConn() {
  try {
    const j = await api('/api/insta/status'); IG.conn = j;
    const s = j.settings;
    $('igConn').innerHTML = [
      [j.sheetOk, '개인 시트', s.sheetPath],
      [j.photoOk, '시공사례 사진 폴더', s.photoRoot],
      [j.queueOk, '구글 드라이브 "' + j.queueName + '" 폴더', s.queueDir || '찾지 못함']
    ].map(([ok, l, p]) => `<div><span class="${ok ? 'y' : 'n'}">${ok ? '✓' : '✕'}</span><span><b>${esc(l)}</b><br><small>${esc(p)}</small></span></div>`).join('') +
      `<div><span class="${KK.claudeReady ? 'y' : 'n'}">${KK.claudeReady ? '✓' : '✕'}</span><span><b>Claude Code</b> (캡션 쓰기)<br><small>${KK.claudeReady ? '연결됨' : '오른쪽 위 [설정] → [Claude Code]를 확인해 주세요'}</small></span></div>`;
    $('igDriveHelp').hidden = j.queueOk;
    $('setSheet').value = s.sheetPath; $('setPhoto').value = s.photoRoot; $('setQueue').value = s.queueDir || '';
    $('setFireId').value = s.fireId || ''; $('setFireToken').value = s.fireToken || ''; showFire(j.fire);
    $('igConnPill').textContent = j.sheetOk && j.photoOk && j.queueOk ? '연결됨' : '확인 필요';
    $('igConnPill').className = 'pill ' + (j.sheetOk && j.photoOk && j.queueOk ? 'ok' : 'bad');
    if (!(j.sheetOk && j.photoOk && j.queueOk)) $('igConnBox').open = true;
  } catch (e) { $('igConn').textContent = e.message; }
  refreshTok();
}

/* 인스타 게시 토큰 (이 PC 의 스튜디오에만 저장 — 값은 화면으로 돌아오지 않아요) */
const igt = async (url, body) => {
  const r = await fetch(url, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-KK-Insta': '1' }, body: body ? JSON.stringify(body) : undefined });
  return r.json().catch(() => ({ ok: false, error: '응답을 읽지 못했어요.' }));
};
const fmtT = ms => { const d = new Date(ms); return `${d.getMonth() + 1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
async function refreshTok() {
  const el = $('igTokState'); if (!el) return;
  const j = await igt('/api/ig/token').catch(() => null);
  if (!j || !j.ok) { el.textContent = '토큰 상태를 확인하지 못했어요.'; el.className = 'hint warn-t'; return; }
  if (!j.has) { el.textContent = '아직 저장 안 됨 — 예약 게시가 올리려면 토큰이 필요해요. 아래에 새 토큰을 붙여 넣고 [토큰 저장]을 눌러 주세요.'; el.className = 'hint warn-t'; return; }
  const left = j.expiresAt ? Math.ceil((j.expiresAt - Date.now()) / 86400e3) : null;
  const l = j.last;
  el.textContent = '저장됨 — 계정 ' + j.username + ' (토큰 ' + j.len + '자)' + (left != null ? ' · 만료까지 약 ' + left + '일' + (j.expiresKnown ? '' : '(추정)') : '') +
    ' · 켜져 있으면 25일마다 자동으로 연장해요' +
    (j.runnerAt ? ' · 예약 작업이 마지막으로 확인한 때: ' + fmtT(j.runnerAt) : '') + (l ? ' · 마지막 인스타 호출: ' + fmtT(l.at) + (l.ok ? ' 성공' : ' 실패') : '');
  el.className = 'hint' + (left != null && left < 10 ? ' warn-t' : '');
}
function initIgToken() {
  if (!$('igTokSave')) return;
  const busy = (b, on, t) => { b.disabled = on; if (t) b.textContent = t; };
  $('igTokSave').addEventListener('click', async e => {
    const b = e.currentTarget, v = $('igTokInput').value.trim(); if (!v) return toast('새 토큰을 먼저 붙여 넣어 주세요.', 'error');
    busy(b, true, '확인 중…');
    try { const j = await igt('/api/ig/token', { token: v }); if (!j.ok) throw Error(j.error || '저장하지 못했어요.'); $('igTokInput').value = ''; toast('토큰을 저장했어요 (계정 ' + j.username + ').', 'ok'); }
    catch (er) { toast(er.message, 'error'); }
    busy(b, false, '토큰 저장'); refreshTok();
  });
  $('igTokRefresh').addEventListener('click', async e => {
    const b = e.currentTarget; busy(b, true, '연장 중…');
    try { const j = await igt('/api/ig/token/refresh', {}); if (!j.ok) throw Error(j.error); toast('토큰을 연장했어요 (' + j.days + '일).', 'ok'); } catch (er) { toast(er.message, 'error'); }
    busy(b, false, '토큰 연장 (60일)'); refreshTok();
  });
  $('igTokTest').addEventListener('click', async e => {
    const b = e.currentTarget; busy(b, true, '시험 중…');
    try { const j = await igt('/api/ig/graph', { path: '/me', method: 'GET', params: { fields: 'username' } }); if (!j.ok) throw Error(j.error); if (j.data && j.data.username) toast('연결됐어요 — ' + j.data.username, 'ok'); else throw Error((j.data && j.data.error && j.data.error.message) || '인스타가 거절했어요.'); }
    catch (er) { toast('연결하지 못했어요: ' + er.message, 'error'); }
    busy(b, false, '연결 시험'); refreshTok();
  });
  refreshTok();
}

/* 추천 현장 */
function renderRecs() {
  const box = $('igRecs'); if (!box) return;
  if (sites.err) { box.innerHTML = `<p class="muted">${esc(sites.err)}</p>`; return; }
  if (!sites.loaded) { box.innerHTML = '<p class="muted">시트 읽는 중…</p>'; return; }
  const list = sites.list.filter(s => s.remaining.length && !s.hold && s.folder).sort((a, b) => siteRank(a) - siteRank(b));
  const n = IG.showAll ? list.length : 8;
  if (!list.length) { box.innerHTML = '<p class="muted">올릴 현장이 없어요. 새 현장이 시트에 추가되면 여기에 나와요.</p>'; return; }
  box.innerHTML = list.slice(0, n).map(s => { const pend = pendingIg(s); return `<button type="button" class="rec ${IG.site && IG.site.id === s.id ? 'on' : ''}" data-id="${esc(s.id)}">
    <span class="t">${esc(shortName(s.name))}</span>
    <span>${s.remaining.map(c => (s.queued || []).includes(c) ? `<span class="ic queued">${ITEM[c] || c} 예약중</span>` : `<span class="ic left">${ITEM[c] || c}</span>`).join('')}${s.seoul ? '<span class="ic seoul">서울</span>' : ''}<span class="ic">사진 ${s.photoCount}장</span>${s.notes ? '<span class="ic done">분류됨</span>' : ''}</span>
    <span class="d${pend.length || (s.dailyPending || []).length ? ' pend' : ''}">${pend.length ? '직접 올렸다고 기록 요청함: ' + [...new Set(pend.flatMap(r => r.items))].map(c => ITEM[c] || c).join(', ') + ' · 시트 반영 대기' : s.dailyDone.length ? '올린 품목: ' + s.dailyDone.map(c => (ITEM[c] || c) + ((s.dailyPending || []).includes(c) ? '(시트 반영 대기)' : '')).join(', ') : '아직 인스타에 한 번도 안 올림'}${(s.queued || []).length ? ' · 예약해 둔 품목: ' + s.queued.map(c => ITEM[c] || c).join(', ') : ''}</span></button>`; }).join('') +
    (list.length > n ? `<button type="button" class="rec" data-more="1"><span class="t">현장 ${list.length - n}곳 더 보기</span></button>` : '');
}

/* 사진 고르기 */
const thumbCache = new Map();
async function thumbOf(folder, name) {
  const k = folder + '/' + name; if (thumbCache.has(k)) return thumbCache.get(k);
  const p = (async () => {
    const b = await (await fetch('/api/insta/file?folder=' + encodeURIComponent(folder) + '&name=' + encodeURIComponent(name))).blob();
    const bmp = await createImageBitmap(b, { resizeWidth: 360, resizeQuality: 'medium' });
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; c.getContext('2d').drawImage(bmp, 0, 0); bmp.close && bmp.close();
    return URL.createObjectURL(await new Promise(r => c.toBlob(r, 'image/jpeg', .8)));
  })();
  thumbCache.set(k, p); p.catch(() => thumbCache.delete(k)); return p;
}
const base = f => f.replace(/\.[^.]+$/, '');
const isPick = (grp, f) => { const b = base(f); for (const p of grp.picks) if (b === p || (p.length >= 3 && b.endsWith(p))) return true; return false; };
async function openSite(s) {
  if (KK.goStep) KK.goStep(2, 'insta');                       // 현장을 고르면 [사진 고르기] 단계로
  IG.site = s; IG.picked = []; IG.crops = []; IG.pvKey = ''; IG.ratio = '4:5'; renderRatioSegs(); renderRecs();
  $('igPick').hidden = false; $('pkTitle').textContent = shortName(s.name); $('pkNote').textContent = '';
  $('pgrid').innerHTML = '<p class="muted">사진 목록 읽는 중…</p>';
  try {
    IG.files = (await api('/api/insta/photos?folder=' + encodeURIComponent(s.folder))).files;
    // 시트 '사진정리' 탭에 분류해 둔 게 있으면 품목별로 묶고 ★ 추천 표시
    IG.groups = null;
    if (s.notes) {
      const g = []; const used = new Set();
      for (const [code, v] of Object.entries(s.notes)) {
        const files = IG.files.filter(f => v.files.includes(base(f)));
        files.forEach(f => used.add(f));
        if (files.length) g.push({ code, files, picks: new Set(v.picks), note: v.note });
      }
      const rest = IG.files.filter(f => !used.has(f));
      if (rest.length) g.push({ code: '', files: rest, picks: new Set() });
      if (g.length) IG.groups = g;
      // 남은 품목의 ★ 사진을 미리 골라 둠
      // 인스타는 보통 한 번에 한 품목 → 남은 품목 중 첫 번째 품목의 ★ 사진만 미리 골라 둠
      const first = g.find(grp => s.remaining.includes(grp.code) && grp.files.some(f => isPick(grp, f))) || g.find(grp => s.remaining.includes(grp.code));
      if (first) for (const f of first.files) if (isPick(first, f) && IG.picked.length < 10) IG.picked.push(f);
    }
    $('pkNote').textContent = IG.groups ? '시트 사진정리 탭 기준으로 품목별로 묶었어요. ★는 추천 사진이고, 남은 품목 하나의 ★ 사진을 미리 골라 뒀어요.' : '사진을 눌러 순서대로 고르세요 (최대 10장).';
    setSiteFields(s);
    renderPicker(); syncCrops();
  } catch (e) { $('pgrid').innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
  $('igPick').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function setSiteFields(s) {
  $('igApt').value = aptGuess(s.name); $('igSeoul').checked = !!s.seoul;
  const note = s.notes ? Object.values(s.notes).map(v => v.note).join(' ') : '';
  const h = /@[A-Za-z0-9._]+/.exec(note);
  $('igCredit').value = h ? '📷 by ' + h[0] : '';
  fillInterior(s);
  IG.items = new Set(s.remaining.slice(0, 1)); renderItems();
  const groupsPicked = IG.groups ? [...new Set(IG.picked.map(f => (IG.groups.find(g => g.files.includes(f)) || {}).code).filter(Boolean))] : [];
  if (groupsPicked.length) IG.items = new Set(groupsPicked);
  renderItems();
  $('igMemo').value = [...IG.items].map(c => ITEM[c]).join(', ') + ([...IG.items].length ? ' 위주' : '');
  renderPreview();
}
function renderPicker() {
  const g = $('pgrid'), grouped = !!IG.groups && !IG.flat;
  const label = f => { if (!IG.groups) return ''; const cs = IG.groups.filter(x => x.code && x.files.includes(f)).map(x => x.code); return cs.length ? `<span class="it">${esc(itemLabel(cs))}</span>` : ''; };
  const card = f => {
    const n = IG.picked.indexOf(f), grp = IG.groups && IG.groups.find(x => x.files.includes(f));
    const star = grp && isPick(grp, f);
    return `<button type="button" class="pk ${n >= 0 ? 'on' : ''}" data-f="${esc(f)}" title="${esc(f)}"><img alt="" data-src="${esc(f)}"><span class="o">${n + 1}</span>${star ? '<span class="star">★</span>' : ''}${grouped ? '' : label(f)}</button>`;
  };
  g.innerHTML = grouped
    ? IG.groups.map(gr => `<div class="pk-group">${gr.code ? esc(ITEM[gr.code] || gr.code) + (IG.site.remaining.includes(gr.code) ? ' <span class="ic left">남음</span>' : ' <span class="ic done">올림</span>') : '분류 안 된 사진'} <small>${gr.files.length}장</small></div><div class="pgrid">${gr.files.map(card).join('')}</div>`).join('')
    : `<div class="pgrid">${IG.files.map(card).join('')}</div>`;
  g.classList.remove('pgrid');
  const vw = $('pkView'); if (vw) { vw.hidden = !IG.groups; vw.querySelectorAll('button').forEach(b => b.classList.toggle('on', (b.dataset.v === 'all') === !!IG.flat)); }
  if (IG.site && IG.groups) $('pkNote').textContent = grouped ? '시트 사진정리 탭 기준으로 품목별로 묶었어요(틀릴 수 있어요). ★는 추천 사진이에요. 분류가 안 맞으면 [전체 사진]을 눌러 모든 사진 중에서 고르세요.' : '이 현장 사진 전체예요. 사진 위 작은 글자는 시트에 분류된 품목이에요(틀릴 수 있어요). 눌러서 순서대로 고르세요 (최대 10장).';
  // 썸네일은 하나씩 차례로 만듭니다 (원본이 커서 한꺼번에 열면 느려요)
  loadThumbs(g, IG.site.folder);
  $('pkCount').textContent = IG.picked.length + '장 고름';
}

/* 사진 비율 — 기본 4:5. 인스타 피드는 4:5(세로)~1.91:1(가로) 사이만 올릴 수 있어서 그 안에서만 골라요 */
const RATIOS = { '4:5': [1080, 1350], '1:1': [1080, 1080], '4:3': [1080, 810], '3:2': [1080, 720], '1.91:1': [1080, 566] };
const RATIO_NOTE = { '4:5': '세로 (기본)', '1:1': '정사각', '4:3': '가로', '3:2': '가로', '1.91:1': '넓은 가로' };
const rdim = () => RATIOS[IG.ratio] || RATIOS['4:5'];
const rnum = () => { const [W, H] = rdim(); return W / H; };
const rsize = w => { const [W, H] = rdim(); return [w, Math.round(w * H / W)]; };
function renderRatioSegs() {
  document.querySelectorAll('[data-ratio-seg]').forEach(box => {
    box.innerHTML = Object.keys(RATIOS).map(k => `<button type="button" data-ratio="${k}" class="${k === IG.ratio ? 'on' : ''}" title="${RATIO_NOTE[k]}${k === '4:5' ? '' : ' — 기본은 4:5예요'}">${k}</button>`).join('');
  });
}
function setRatio(k) {
  if (!RATIOS[k] || k === IG.ratio) return;
  IG.ratio = k; renderRatioSegs(); renderCrops();
}

/* 자르기 — 사진마다 끌어서(또는 미리보기의 화살표로) 보일 부분을 맞춰요 */
async function loadBitmap(c) {
  if (c.bmp) return c.bmp;
  const blob = c.blob || await (await fetch('/api/insta/file?folder=' + encodeURIComponent(c.folder) + '&name=' + encodeURIComponent(c.name))).blob();
  c.blob = blob;
  const probe = await createImageBitmap(blob);
  const sc = Math.min(1, 1600 / Math.max(probe.width, probe.height));
  c.bmp = sc < 1 ? await createImageBitmap(blob, { resizeWidth: Math.round(probe.width * sc), resizeQuality: 'high' }) : probe;
  if (sc < 1 && probe.close) probe.close();
  return c.bmp;
}
function drawCrop(ctx, bmp, c, W, H) {
  const r = W / H, z = c.zoom || 1;
  let sw = bmp.width, sh = bmp.height;
  if (sw / sh > r) sw = sh * r; else sh = sw / r;
  sw /= z; sh /= z;
  const sx = (bmp.width - sw) / 2 * (1 + (c.ox || 0)), sy = (bmp.height - sh) / 2 * (1 + (c.oy || 0));
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  // 밝기·대비·채도 (사진마다, -50~+50 / 채도 -100~+100). 최종 사진에도 그대로 구워져요
  const br = c.br || 0, ct = c.ct || 0, sa = c.sa || 0;
  if (br || ct || sa) ctx.filter = `brightness(${1 + br / 100}) contrast(${1 + ct / 100}) saturate(${1 + sa / 100})`;
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, W, H);
  ctx.filter = 'none';
}
// 이 사진이 가로·세로로 더 움직일 여유가 있는지 (사진이 틀에 딱 맞으면 그 방향은 움직일 게 없어요)
function slack(c) {
  if (!c || !c.bmp) return { x: false, y: false };
  const r = rnum(), z = c.zoom || 1;
  let sw = c.bmp.width, sh = c.bmp.height;
  if (sw / sh > r) sw = sh * r; else sh = sw / r;
  return { x: c.bmp.width - sw / z > 1, y: c.bmp.height - sh / z > 1 };
}
const clampPan = v => Math.round(Math.max(-1, Math.min(1, v)) * 1000) / 1000;
function attachPan(cv, getCrop, onStart, onMove, onEnd) {
  // 사진이 손가락·마우스를 그대로 따라오도록(1:1) 움직여요. 틀에 딱 맞는 방향은 움직일 여유가 없어 그대로예요.
  let drag = null;
  cv.addEventListener('pointerdown', e => {
    if (e.button != null && e.button > 0) return;
    const c = getCrop(); if (!c) return; onStart && onStart(c);
    drag = { x: e.clientX, y: e.clientY, ox: c.ox || 0, oy: c.oy || 0, c };
    try { cv.setPointerCapture(e.pointerId); } catch (_) {}
    const st = cv.closest('.ig-stage'); if (st) st.classList.add('drag');
    e.preventDefault();
  });
  cv.addEventListener('pointermove', e => {
    if (!drag || !drag.c.bmp) return;
    const c = drag.c, r = cv.getBoundingClientRect(), ratio = cv.width / cv.height, z = c.zoom || 1;
    let sw = c.bmp.width, sh = c.bmp.height;
    if (sw / sh > ratio) sw = sh * ratio; else sh = sw / ratio;
    sw /= z; sh /= z;
    const slx = (c.bmp.width - sw) / 2, sly = (c.bmp.height - sh) / 2;     // 좌우·상하로 움직일 수 있는 원본 픽셀 여유
    if (slx > 0.5) c.ox = clampPan(drag.ox - ((e.clientX - drag.x) / r.width * sw) / slx);
    if (sly > 0.5) c.oy = clampPan(drag.oy - ((e.clientY - drag.y) / r.height * sh) / sly);
    onMove(c);
  });
  const end = () => { if (!drag) return; const c = drag.c; drag = null; const st = cv.closest('.ig-stage'); if (st) st.classList.remove('drag'); onEnd(c); };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
}
function syncCrops() {
  const keep = new Map(IG.crops.map(c => [c.key, c])), had = IG.crops.length;
  const next = IG.picked.map(f => keep.get(IG.site.folder + '/' + f) || { key: IG.site.folder + '/' + f, folder: IG.site.folder, name: f, ox: 0, oy: 0, zoom: 1 });
  IG.crops = next.concat(IG.crops.filter(c => c.own));
  const added = next.filter(c => !keep.has(c.key));
  if (had && added.length) IG.pvKey = added[added.length - 1].key;   // 방금 고른 사진을 미리보기에 바로 보여 줘요
  renderCrops();
}
function renderCrops() {
  const box = $('igCrops'), [cw, ch] = rsize(352), [W, H] = rdim();
  $('igCropPanel').hidden = !IG.crops.length;
  box.style.setProperty('--pr', rnum());
  box.innerHTML = IG.crops.map((c, i) => `<div class="crop" data-i="${i}"><canvas width="${cw}" height="${ch}"></canvas>
    <div class="row"><span class="n">${i + 1}${i === 0 ? ' · 대표' : ''}</span><button type="button" class="tiny" data-mv="-1" ${i ? '' : 'disabled'}>◀</button><button type="button" class="tiny" data-mv="1" ${i < IG.crops.length - 1 ? '' : 'disabled'}>▶</button><button type="button" class="tiny" data-rm="1">✕</button></div>
    <div class="row"><span style="white-space:nowrap">확대</span><input type="range" min="100" max="200" value="${Math.round((c.zoom || 1) * 100)}" data-zoom="1"></div></div>`).join('');
  box.querySelectorAll('.crop').forEach(el => {
    const c = IG.crops[+el.dataset.i], cv = el.querySelector('canvas'), ctx = cv.getContext('2d');
    const paint = () => { if (c.bmp) drawCrop(ctx, c.bmp, c, cv.width, cv.height); };
    el._paint = paint;
    loadBitmap(c).then(() => { paint(); renderPreview(); }).catch(() => { ctx.fillStyle = '#eee'; ctx.fillRect(0, 0, cv.width, cv.height); });
    attachPan(cv, () => c, () => { if (IG.pvKey !== c.key) { IG.pvKey = c.key; renderPreview(); } },
      () => { paint(); if (IG.pvKey === c.key) afterAdjust(true); }, () => afterAdjust());
    el.querySelector('[data-zoom]').addEventListener('input', e => { c.zoom = +e.target.value / 100; paint(); if (IG.pvKey !== c.key) { IG.pvKey = c.key; renderPreview(); } else afterAdjust(true); });
  });
  $('igCropTitle').textContent = IG.ratio + ' 사진';
  $('igCropCount').textContent = IG.crops.length + '장 · ' + IG.ratio + ' (' + W + '×' + H + ')';
  renderPreview();
}
async function cropJpeg(c) {
  // 최종 사진은 원본에서 바로 잘라 화질을 지킵니다
  const full = await createImageBitmap(c.blob || await (await fetch('/api/insta/file?folder=' + encodeURIComponent(c.folder) + '&name=' + encodeURIComponent(c.name))).blob());
  const [W, H] = rdim(), cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  drawCrop(cv.getContext('2d'), full, c, W, H); full.close && full.close();
  return cv.toDataURL('image/jpeg', .9);
}

async function storyJpeg(dataUrl) {
  // 대표 사진을 9:16 스토리 배경(같은 사진을 흐리게 깔고) 한가운데에 얹어요
  const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(Error('스토리 이미지를 만들지 못했어요.')); i.src = dataUrl; });
  const cv = document.createElement('canvas'); cv.width = 1080; cv.height = 1920; const g = cv.getContext('2d');
  const k = Math.max(1920 / img.height, 1080 / img.width) * 1.25; g.filter = 'blur(40px) brightness(.8)'; g.drawImage(img, (1080 - img.width * k) / 2, (1920 - img.height * k) / 2, img.width * k, img.height * k); g.filter = 'none';
  g.drawImage(img, 0, (1920 - img.height) / 2, 1080, img.height);
  return cv.toDataURL('image/jpeg', .9);
}

/* 미리보기 — 오른쪽에 계속 붙어 있어서, 본문을 쓰면서 바로 사진을 넘기고 고칠 수 있어요 */
function curIdx() {
  if (!IG.crops.length) return -1;
  let i = IG.crops.findIndex(c => c.key === IG.pvKey);
  if (i < 0) { i = 0; IG.pvKey = IG.crops[0].key; }
  return i;
}
function setPv(i) { if (i < 0 || i >= IG.crops.length) return; IG.pvKey = IG.crops[i].key; renderPreview(); }
function paintStage() {
  const cv = $('igPrevCanvas'), [pw, ph] = rsize(540);
  if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
  const x = cv.getContext('2d'), c = IG.crops[curIdx()];
  if (c && c.bmp) { drawCrop(x, c.bmp, c, cv.width, cv.height); return; }
  x.fillStyle = '#f1ece5'; x.fillRect(0, 0, cv.width, cv.height);
  if (c) { x.fillStyle = '#9a8f82'; x.font = '18px sans-serif'; x.textAlign = 'center'; x.fillText('사진 읽는 중…', cv.width / 2, cv.height / 2); }
}
function paintThumb(cv, c) {
  const [tw, th] = rsize(96); if (cv.width !== tw || cv.height !== th) { cv.width = tw; cv.height = th; }
  if (c.bmp) drawCrop(cv.getContext('2d'), c.bmp, c, tw, th);
}
function refreshCard(i) {
  const el = $('igCrops').children[i]; if (!el) return;
  el._paint && el._paint();
  const sl = el.querySelector('[data-zoom]'); if (sl) sl.value = Math.round((IG.crops[i].zoom || 1) * 100);
}
// 위치·확대를 바꾼 뒤: 전체를 다시 그리지 않고 필요한 곳만 새로 그려요
function afterAdjust(skipCard) {
  const i = curIdx(); if (i < 0) return;
  paintStage();
  if (!skipCard) refreshCard(i);
  const t = $('igThumbs').children[i]; if (t && t.firstChild) paintThumb(t.firstChild, IG.crops[i]);
  renderTools();
}
function renderTools() {
  const box = $('igTools'), n = IG.crops.length, i = curIdx(), c = IG.crops[i];
  box.hidden = !n; if (!n) return;
  const sl = slack(c), ox = c.ox || 0, oy = c.oy || 0, z = c.zoom || 1;
  box.querySelectorAll('[data-pos]').forEach(b => {
    const [dx, dy] = b.dataset.pos.split(',').map(Number);
    b.disabled = !(dx ? sl.x && (dx < 0 ? ox > -1 : ox < 1) : sl.y && (dy < 0 ? oy > -1 : oy < 1));
  });
  $('igZoomVal').textContent = Math.round(z * 100) + '%';
  const gb = $('igGrab'); if (gb) gb.textContent = sl.x || sl.y ? '✥ 끌어서 위치 맞추기' : '＋ 확대하면 끌어서 맞출 수 있어요';
  box.querySelector('[data-zm="-1"]').disabled = z <= 1.0001;
  box.querySelector('[data-zm="1"]').disabled = z >= 1.9999;
  box.querySelector('[data-mvp="-1"]').disabled = i <= 0;
  box.querySelector('[data-mvp="1"]').disabled = i >= n - 1;
  $('igReset').disabled = !(ox || oy || z !== 1);
  box.querySelectorAll('[data-adj]').forEach(inp => {
    const v = c[inp.dataset.adj] || 0; if (+inp.value !== v) inp.value = v;
    box.querySelector(`[data-adjv="${inp.dataset.adj}"]`).textContent = (v > 0 ? '+' : '') + v;
  });
  $('igAdjReset').disabled = !(c.br || c.ct || c.sa);
}
function renderPreview() {
  const n = IG.crops.length, i = curIdx();
  $('igStage').style.setProperty('--pr', rnum());
  paintStage();
  $('igPvNum').textContent = n ? (i + 1) + '/' + n : '0/0';
  $('igBadge').textContent = n ? (n > 1 ? (i + 1) + '/' + n : '') + (i === 0 ? (n > 1 ? ' · ' : '') + '대표' : '') : '';
  $('igPrevBtn').disabled = i <= 0;
  $('igNextBtn').disabled = i < 0 || i >= n - 1;
  $('igDots').innerHTML = n > 1 ? IG.crops.map((_, k) => `<i data-i="${k}" class="${k === i ? 'on' : ''}" title="${k + 1}번 사진"></i>`).join('') : '';
  const th = $('igThumbs');
  th.innerHTML = n > 1 ? IG.crops.map((_, k) => `<button type="button" class="th ${k === i ? 'on' : ''}" data-i="${k}" title="${k + 1}번 사진${k ? '' : ' (대표)'}"><canvas></canvas><span class="no">${k + 1}</span></button>`).join('') : '';
  th.querySelectorAll('.th').forEach(b => paintThumb(b.firstChild, IG.crops[+b.dataset.i]));
  document.querySelectorAll('#igCrops .crop').forEach((el, k) => el.classList.toggle('cur', k === i));
  renderTools();
  renderCaption();
}

/* 품목 · 톤 */
function renderItems() {
  $('igItems').innerHTML = Object.entries(ITEM).map(([k, v]) => `<button type="button" class="chip ${IG.items.has(k) ? 'on' : ''}" data-item="${k}">${v}${IG.site && IG.site.remaining.includes(k) ? ' ·남음' : ''}</button>`).join('');
}
function renderTones() { $('igTones').innerHTML = TONES.map(t => `<button type="button" class="chip ${IG.tones.has(t) ? 'on' : ''}" data-tone="${esc(t)}">${esc(t)}</button>`).join(''); }

/* 캡션 */
const isSeoul = () => $('igSeoul').checked;
function fullText() {
  const apt = $('igApt').value.trim(), body = $('igBody').value.trim(), cr = creditBlock();
  return (apt && !isSeoul() ? tagOf(apt) + '\n\n' : '') + body + '\n\n' + (cr ? cr + '\n\n' : '') + FOOTER;
}
function renderCaption() {
  const cap = $('igCap'), apt = $('igApt').value.trim(), body = $('igBody').value.trim(), cr = creditBlock();
  if (!body) { cap.innerHTML = '<span class="note">캡션을 만들거나 직접 쓰면 해시태그부터 방문예약까지 완성된 글이 보여요.</span>'; return; }
  cap.innerHTML = (apt && !isSeoul() ? `<span class="tag">${esc(tagOf(apt))}</span>\n\n` : '') + esc(body) + '\n\n' + (cr ? esc(cr) + '\n\n' : '') + `<span class="foot">${esc(FOOTER)}</span>` +
    (apt && isSeoul() ? `\n\n<span class="note">(서울 현장: 게시 후 댓글 ✨ → 대댓글 ${esc(tagOf(apt))})</span>` : '');
}
// 키친앤코 문체 — 사장님이 확정한 실제 본문을 이번 현장 품목·컬러에 맞춰 골라서 Claude에게 보여 줘요
async function styleBlock() {
  let ex = [], sh = [], ph = [];
  try {
    const j = await api('/api/insta/style?items=' + [...IG.items].join(',') + '&tones=' + encodeURIComponent([...IG.tones].join(',')) + '&n=9&m=5');
    ex = j.examples || []; sh = j.short || []; ph = j.phrases || [];
  } catch (_) {}
  const seen = new Set(), main = [];
  for (const t of [...(IG.memory.confirmed || []).slice(0, 5), ...ex, ...SEED]) { const k = t.slice(0, 24); if (seen.has(k)) continue; seen.add(k); main.push(t); if (main.length >= 14) break; }
  return '\n\n[키친앤코가 실제로 확정해서 올린 본문 — 이 문체가 정답이다. 문장 구조, 어휘, 리듬, 길이, 끝맺음을 거의 그대로 따라 쓴다. 새 글은 아래 글들과 같은 사람이 쓴 것처럼 읽혀야 한다. 단, 내용은 베끼지 말고 이번 사진에 보이는 것으로 바꿔 쓴다]\n' + main.map((t, i) => `${i + 1}. ${t}`).join('\n') +
    (sh.length ? '\n\n[한 문장으로 쓴 확정 글 — 표현과 어휘만 참고한다. 이번 글은 2문장으로 쓴다]\n' + sh.map(t => '- ' + t).join('\n') : '') +
    (ph.length ? '\n\n[키친앤코가 자주 쓰는 표현]\n' + ph.join(' / ') : '');
}
function fbText() { const f = (IG.memory.feedback || []).slice(0, 25).map(x => '- ' + x).join('\n'); return f ? `\n\n[사장님이 이전에 고쳐달라고 한 내용 — 반드시 반영]\n${f}` : ''; }
function ctx() {
  const memo = $('igMemo').value.trim();
  return `\n\n[이번 현장]\n- 사진 ${IG.crops.length}장 (01이 대표 사진, 파일 번호 = 게시물 사진 순서)` +
    (IG.items.size ? `\n- 이번 글 품목: ${[...IG.items].map(c => ITEM[c]).join(', ')}` : '') +
    (IG.tones.size ? `\n- 가구 컬러(사장님 지정, 그대로 사용): ${[...IG.tones].join(', ')}` : '') +
    (memo ? `\n- 사장님 메모: ${memo}` : '');
}
async function claudeRun(prompt, withImages, onTick) {
  if (!KK.claudeReady && KK.checkClaude) await KK.checkClaude();
  if (!KK.claudeReady) throw Error('Claude Code가 연결되지 않았어요. 오른쪽 위 [설정] → [Claude Code]를 확인해 주세요.');
  const images = [];
  if (withImages) for (let i = 0; i < IG.crops.length; i++) {
    const c = IG.crops[i]; await loadBitmap(c);
    const [aw, ah] = rsize(864), cv = document.createElement('canvas'); cv.width = aw; cv.height = ah; drawCrop(cv.getContext('2d'), c.bmp, c, aw, ah);
    images.push({ name: String(i + 1).padStart(2, '0') + '.jpg', data: cv.toDataURL('image/jpeg', .85) });
  }
  if (withImages && !images.length) throw Error('사진을 한 장 이상 골라 주세요.');
  const st = await api('/api/claude/start', { prompt: prompt + '\n\n(참고: 이번 요청은 블로그가 아니라 인스타 캡션이에요. 파일 번호는 게시물 사진 순서입니다.)', images: images.length ? images : [{ name: '00.jpg', data: await blankJpeg() }] });
  IG.job = st.id;
  try {
    for (;;) {
      await new Promise(r => setTimeout(r, 2000));
      const j = await api('/api/claude/job?id=' + st.id);
      if (j.state === 'running') { onTick && onTick(j.seconds); continue; }
      if (j.state === 'error') throw Error(j.error === 'NOT_INSTALLED' ? 'Claude Code가 설치돼 있지 않아요.' : j.error);
      const m = /\{[\s\S]*\}/.exec(j.result || ''); if (!m) throw Error('답을 읽지 못했어요. 한 번 더 눌러 주세요.');
      return JSON.parse(m[0]);
    }
  } finally { IG.job = null; }
}
async function blankJpeg() { const c = document.createElement('canvas'); c.width = c.height = 8; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 8, 8); return c.toDataURL('image/jpeg', .8); }
function setStatus(id, m, k = '') { const el = $(id); el.hidden = !m; el.textContent = m || ''; el.className = 'status ' + k; }
function renderOpts() {
  $('igOpts').innerHTML = IG.options.map((t, i) => `<button type="button" class="opt ${IG.pick === i ? 'on' : ''}" data-i="${i}"><span class="k">안 ${i + 1}</span>${esc(t)}</button>`).join('');
}

/* 예약 목록 */
async function loadQueue() {
  try {
    const j = await api('/api/insta/queue'); IG.queue = j.posts;
    $('igQueueTab').textContent = IG.queue.filter(p => p.status !== '게시 완료').length || '';
    renderQueue();
  } catch (e) { $('igQueue').innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
  const d = $('igDate'); d.min = ymd(new Date()); d.placeholder = nextFreeDay(); $('igDateHint').textContent = '비워 두면 ' + fmtD(nextFreeDay()) + ' 아침 9시쯤';
}
function renderQueue() {
  const box = $('igQueue');
  if (!IG.queue.length) { box.innerHTML = '<p class="muted">예약한 글이 없어요.</p>'; return; }
  const list = [...IG.queue.filter(p => p.status !== '게시 완료'), ...IG.queue.filter(p => p.status === '게시 완료').reverse().slice(0, 10)];
  box.innerHTML = list.map(p => {
    const done = p.status === '게시 완료';
    return `<div class="qitem" data-id="${esc(p.id)}"><div class="h"><b>${esc(p.hashtag || tagOf(p.apt))}</b><span class="pill ${done ? 'done' : 'wait'}">${done ? '게시 완료' : p.postNow ? '바로 발행 대기' : fmtD(p.scheduledDate) + ' 예약'}</span>${p.story ? '<span class="pill">스토리 포함</span>' : ''}</div>
      <div class="qthumbs">${(p.photos || []).map(n => `<img alt="" loading="lazy" src="/api/insta/qfile?name=${encodeURIComponent(n)}" onerror="this.style.visibility='hidden'">`).join('')}</div>
      <p>${esc(p.body || '')}</p>
      ${p.missing && p.missing.length && !done ? `<span class="muted">⚠ 사진 ${p.missing.length}장이 폴더에 없어요</span>` : ''}
      <div class="acts">${done ? (p.permalink ? `<a href="${esc(p.permalink)}" target="_blank" rel="noopener">게시물 보기</a>` : '') + `<button type="button" class="tiny" data-dl="1" title="이 글의 사진과 글을 zip 파일로 받아요">사진·글 받기</button>` : `<button type="button" class="tiny" data-dl="1" title="인스타 자동 게시가 안 될 때 — 사진과 글을 zip 파일로 받아서 직접 올려요">사진·글 받기</button><input type="date" value="${esc(p.scheduledDate)}" min="${ymd(new Date())}" data-date="1"><button type="button" class="tiny" data-copy="1">글 복사</button>${p.postNow ? '' : '<button type="button" class="tiny" data-now="1">지금 올리기</button>'}<button type="button" class="tiny" data-del="1">${p.postNow ? '취소' : '예약 취소'}</button>`}</div></div>`;
  }).join('');
}

function initInsta() {
  renderTones(); renderItems();
  $('igRecs').addEventListener('click', e => {
    const b = e.target.closest('.rec'); if (!b) return;
    if (b.dataset.more) { IG.showAll = true; return renderRecs(); }
    const s = sites.list.find(x => x.id === b.dataset.id); if (s) { openSite(s); markSelect(s); }
  });
  $('igReload').addEventListener('click', () => { loadSites(true); loadRecords(); });
  $('pgrid').addEventListener('click', e => {
    const b = e.target.closest('[data-f]'); if (!b) return;
    const f = b.dataset.f, i = IG.picked.indexOf(f);
    const order = [...document.querySelectorAll('#pgrid [data-f]')].map(x => x.dataset.f), at = order.indexOf(f);
    if (e.shiftKey && IG.lastPick >= 0 && IG.lastPick < order.length) {   // Shift: 마지막으로 누른 사진부터 여기까지 한꺼번에
      const [a, z] = [Math.min(IG.lastPick, at), Math.max(IG.lastPick, at)], on = i < 0;
      for (let k = a; k <= z; k++) { const x = order[k], j = IG.picked.indexOf(x); if (on && j < 0) { if (IG.picked.length >= 10) { toast('인스타는 사진 10장까지예요.', 'error'); break; } IG.picked.push(x); } else if (!on && j >= 0) IG.picked.splice(j, 1); }
      window.getSelection && window.getSelection().removeAllRanges();
    } else if (i >= 0) IG.picked.splice(i, 1); else if (IG.picked.length < 10) IG.picked.push(f); else return toast('인스타는 사진 10장까지예요.', 'error');
    IG.lastPick = at;
    g2();
  });
  const g2 = () => {
    document.querySelectorAll('#pgrid [data-f]').forEach(b => { const n = IG.picked.indexOf(b.dataset.f); b.classList.toggle('on', n >= 0); b.querySelector('.o').textContent = n + 1; });
    $('pkCount').textContent = IG.picked.length + '장 고름';
    if (IG.groups && !IG.flat) { const codes = [...new Set(IG.picked.map(f => (IG.groups.find(g => g.files.includes(f)) || {}).code).filter(Boolean))]; if (codes.length) { IG.items = new Set(codes); renderItems(); } }
    syncCrops();
  };
  $('pkClear').addEventListener('click', () => { IG.picked = []; g2(); });
  try { IG.flat = localStorage.getItem('kk-pick-flat') === '1'; } catch (_) {}
  $('pkView').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (!b) return; IG.flat = b.dataset.v === 'all'; try { localStorage.setItem('kk-pick-flat', IG.flat ? '1' : '0'); } catch (_) {} renderPicker(); });
  $('pkBlog').addEventListener('click', e => { if (!IG.site) return; sendToBlog(IG.site, IG.picked.length ? IG.picked : null, null); });
  // 직접 끌어다 놓은 사진도 쓸 수 있어요
  const drop = $('igDrop'), inp = $('igFile');
  const addOwn = async files => {
    for (const f of [...files].filter(f => /^image\//.test(f.type))) {
      if (IG.crops.length >= 10) { toast('인스타는 사진 10장까지예요.', 'error'); break; }
      const oc = { key: 'own:' + Math.random().toString(36).slice(2), own: true, name: f.name, blob: f, ox: 0, oy: 0, zoom: 1 };
      IG.crops.push(oc); IG.pvKey = oc.key;
    }
    renderCrops();
  };
  inp.addEventListener('change', e => { addOwn(e.target.files); e.target.value = ''; });
  ['dragover', 'dragenter'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, () => drop.classList.remove('over')));
  drop.addEventListener('drop', e => { e.preventDefault(); if (e.dataTransfer.files.length) addOwn(e.dataTransfer.files); });
  /* 사진 순서 바꾸기 · 빼기 (아래 사진 카드와 오른쪽 미리보기가 같이 써요) */
  const syncPickUI = () => {
    document.querySelectorAll('#pgrid [data-f]').forEach(b => { const n = IG.picked.indexOf(b.dataset.f); b.classList.toggle('on', n >= 0); b.querySelector('.o').textContent = n + 1; });
    $('pkCount').textContent = IG.picked.length + '장 고름';
  };
  const rmCrop = i => {
    const c = IG.crops[i]; if (!c) return;
    if (c.key === IG.pvKey) { const nb = IG.crops[i + 1] || IG.crops[i - 1]; IG.pvKey = nb ? nb.key : ''; }
    IG.crops.splice(i, 1);
    if (!c.own) IG.picked = IG.picked.filter(f => IG.site.folder + '/' + f !== c.key);
    syncPickUI(); renderCrops();
  };
  const mvCrop = (i, d) => {
    const j = i + d; if (i < 0 || j < 0 || j >= IG.crops.length) return;
    const [c] = IG.crops.splice(i, 1); IG.crops.splice(j, 0, c);
    IG.picked = IG.crops.filter(x => !x.own).map(x => x.name); IG.pvKey = c.key;
    syncPickUI(); renderCrops();
  };
  $('igCrops').addEventListener('click', e => {
    const el = e.target.closest('.crop'); if (!el) return; const i = +el.dataset.i;
    if (e.target.closest('[data-rm]')) return rmCrop(i);
    const mv = e.target.closest('[data-mv]'); if (mv) mvCrop(i, +mv.dataset.mv);
  });

  /* 오른쪽 미리보기: 화살표로 사진 넘기기 · 보일 부분 옮기기 · 확대 · 순서 · 빼기 — 스크롤 없이 한 화면에서 */
  renderRatioSegs();
  document.addEventListener('click', e => { const b = e.target.closest('[data-ratio-seg] [data-ratio]'); if (b) setRatio(b.dataset.ratio); });
  $('igPrevBtn').addEventListener('click', () => setPv(curIdx() - 1));
  $('igNextBtn').addEventListener('click', () => setPv(curIdx() + 1));
  $('igDots').addEventListener('click', e => { const d = e.target.closest('[data-i]'); if (d) setPv(+d.dataset.i); });
  $('igThumbs').addEventListener('click', e => { const t = e.target.closest('[data-i]'); if (t) setPv(+t.dataset.i); });
  $('igStage').addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); setPv(curIdx() - 1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); setPv(curIdx() + 1); }
  });
  attachPan($('igPrevCanvas'), () => IG.crops[curIdx()], null, () => afterAdjust(), () => afterAdjust());

  let holdT = null, holdI = null;
  const stopHold = () => { clearTimeout(holdT); clearInterval(holdI); holdT = holdI = null; };
  const hold = (btn, act) => {
    btn.addEventListener('pointerdown', e => {
      if (e.button) return; e.preventDefault(); stopHold();
      if (!act()) return;
      holdT = setTimeout(() => { holdI = setInterval(() => { if (!act()) stopHold(); }, 70); }, 350);   // 꾹 누르면 계속 움직여요
    });
    btn.addEventListener('click', e => { if (e.detail === 0) act(); });   // 키보드(Enter/스페이스)
  };
  ['pointerup', 'pointercancel'].forEach(ev => document.addEventListener(ev, stopHold)); window.addEventListener('blur', stopHold);
  const nudge = (dx, dy) => {
    const c = IG.crops[curIdx()]; if (!c || !c.bmp) return false;
    const sl = slack(c), STEP = .15; let ch = false;
    if (dx && sl.x) { const v = clampPan((c.ox || 0) + dx * STEP); if (v !== (c.ox || 0)) { c.ox = v; ch = true; } }
    if (dy && sl.y) { const v = clampPan((c.oy || 0) + dy * STEP); if (v !== (c.oy || 0)) { c.oy = v; ch = true; } }
    if (ch) afterAdjust(); return ch;
  };
  const zoomBy = d => {
    const c = IG.crops[curIdx()]; if (!c) return false;
    const z = Math.max(1, Math.min(2, Math.round(((c.zoom || 1) + d * .1) * 100) / 100));
    if (z === (c.zoom || 1)) return false; c.zoom = z; afterAdjust(); return true;
  };
  $('igTools').querySelectorAll('[data-pos]').forEach(b => { const [dx, dy] = b.dataset.pos.split(',').map(Number); hold(b, () => nudge(dx, dy)); });
  $('igTools').querySelectorAll('[data-zm]').forEach(b => hold(b, () => zoomBy(+b.dataset.zm)));
  $('igReset').addEventListener('click', () => { const c = IG.crops[curIdx()]; if (!c) return; c.ox = 0; c.oy = 0; c.zoom = 1; afterAdjust(); });
  $('igTools').querySelectorAll('[data-mvp]').forEach(b => b.addEventListener('click', () => mvCrop(curIdx(), +b.dataset.mvp)));
  $('igRemove').addEventListener('click', () => rmCrop(curIdx()));
  // 밝기·대비·채도: 지금 보는 사진에 바로 적용 (막대를 끌면 미리보기가 바로 바뀌어요)
  $('igTools').querySelectorAll('[data-adj]').forEach(inp => {
    const k = inp.dataset.adj;
    inp.addEventListener('input', () => { const c = IG.crops[curIdx()]; if (!c) return; c[k] = +inp.value; afterAdjust(); });
    inp.addEventListener('dblclick', () => { const c = IG.crops[curIdx()]; if (!c) return; c[k] = 0; afterAdjust(); });
  });
  $('igAdjReset').addEventListener('click', () => { const c = IG.crops[curIdx()]; if (!c) return; c.br = c.ct = c.sa = 0; afterAdjust(); });
  $('igAdjAll').addEventListener('click', () => {
    const c = IG.crops[curIdx()]; if (!c) return;
    IG.crops.forEach(x => { x.br = c.br || 0; x.ct = c.ct || 0; x.sa = c.sa || 0; });
    renderCrops(); toast('지금 사진의 밝기·대비·채도를 모든 사진(' + IG.crops.length + '장)에 똑같이 적용했어요.', 'ok');
  });
  renderPreview();
  $('igItems').addEventListener('click', e => { const b = e.target.closest('[data-item]'); if (!b) return; const k = b.dataset.item; IG.items.has(k) ? IG.items.delete(k) : IG.items.add(k); renderItems(); });
  $('igTones').addEventListener('click', e => { const b = e.target.closest('[data-tone]'); if (!b) return; const t = b.dataset.tone; IG.tones.has(t) ? IG.tones.delete(t) : IG.tones.add(t); renderTones(); });
  ['igApt', 'igBody', 'igCredit', 'igInterior'].forEach(id => $(id).addEventListener('input', renderCaption));
  $('igSeoul').addEventListener('change', renderCaption);
  $('igOpts').addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (!b) return; IG.pick = +b.dataset.i; $('igBody').value = IG.options[IG.pick]; renderOpts(); renderPreview(); });

  $('igGen').addEventListener('click', async () => {
    if (!IG.crops.length) return setStatus('igGenStatus', '사진을 한 장 이상 골라 주세요.', 'error');
    $('igGen').disabled = true; $('igStop').hidden = false;
    setStatus('igGenStatus', 'Claude가 사진을 보고 쓰는 중… (보통 30초~1분)');
    try {
      const prompt = RULES + await styleBlock() + fbText() + ctx() + '\n\n서로 다른 관점의 2문장 본문 3안을 써라. 다른 말 없이 오직 JSON으로만 답한다: {"options":["안1","안2","안3"]}';
      const r = await claudeRun(prompt, true, s => setStatus('igGenStatus', 'Claude가 사진을 보고 쓰는 중… ' + s + '초'));
      IG.options = (Array.isArray(r.options) ? r.options : []).map(String).filter(Boolean).slice(0, 3);
      if (!IG.options.length) throw Error('답을 읽지 못했어요. 한 번 더 눌러 주세요.');
      IG.pick = 0; IG.feedback = []; $('igBody').value = IG.options[0]; renderOpts(); renderPreview();
      setStatus('igGenStatus', '3안을 만들었어요. 고르거나 직접 고쳐 주세요.', 'ok');
    } catch (e) { setStatus('igGenStatus', e.message, 'error'); }
    finally { $('igGen').disabled = false; $('igStop').hidden = true; }
  });
  $('igStop').addEventListener('click', () => { if (IG.job) fetch('/api/claude/cancel?id=' + IG.job, { method: 'POST' }).catch(() => {}); });
  $('igRefineBtn').addEventListener('click', async () => {
    const ask = $('igRefine').value.trim(), body = $('igBody').value.trim(); if (!ask || !body) return;
    $('igRefineBtn').disabled = true; setStatus('igGenStatus', '고치는 중…');
    try {
      const prompt = RULES + await styleBlock() + fbText() + ctx() + `\n\n[현재 본문]\n${body}\n\n[사장님 수정 요청]\n${ask}\n\n요청을 반영해 2문장 본문을 다시 써라. 요청 외 부분은 최대한 유지한다. 다른 말 없이 오직 JSON으로만 답한다: {"text":"..."}`;
      const r = await claudeRun(prompt, IG.crops.length > 0, s => setStatus('igGenStatus', '고치는 중… ' + s + '초'));
      if (!r.text) throw Error('답을 읽지 못했어요. 한 번 더 눌러 주세요.');
      $('igBody').value = String(r.text); renderPreview(); IG.feedback.push(ask); $('igRefine').value = '';
      IG.memory.feedback = [ask, ...(IG.memory.feedback || [])]; api('/api/insta/memory', { feedback: ask }).catch(() => {});
      setStatus('igGenStatus', '고쳤어요. 이 요청은 다음 캡션부터 기억해요.', 'ok');
    } catch (e) { setStatus('igGenStatus', e.message, 'error'); }
    finally { $('igRefineBtn').disabled = false; }
  });
  $('igRefine').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('igRefineBtn').click(); } });
  $('igCopy').addEventListener('click', async () => { if (!$('igBody').value.trim()) return setStatus('igSaveStatus', '먼저 캡션을 만들어 주세요.', 'error'); await KK.copy(fullText()); setStatus('igSaveStatus', '글 전체를 복사했어요.', 'ok'); });

  const save = async now => {
    const apt = $('igApt').value.trim(), body = $('igBody').value.trim();
    if (!apt || !body) return setStatus('igSaveStatus', '아파트명과 본문이 있어야 올릴 수 있어요.', 'error');
    if (!IG.crops.length) return setStatus('igSaveStatus', '사진을 한 장 이상 골라 주세요.', 'error');
    if (!IG.items.size && IG.site && !confirm('이번 글 품목을 고르지 않았어요. 시트 데일리 칸에 기록되지 않아요. 그대로 진행할까요?')) return;
    if (IG.site && IG.company && !handleOf($('igInterior').value) && !confirm(IG.company + ' 공사 현장인데 인테리어 업체 태그가 비어 있어요. 태그 없이 진행할까요?')) return;
    // 같은 현장·품목을 또 올리는 사고 방지: 이미 예약해 뒀거나, 올린 걸로 기록된 품목이면 한 번 더 물어봐요
    if (IG.site && IG.items.size) {
      const f = sites.list.find(x => x.id === IG.site.id) || IG.site, nm = a => a.map(c => ITEM[c] || c).join(', ');
      const dupQ = [...IG.items].filter(c => (f.queued || []).includes(c)), dupD = [...IG.items].filter(c => (f.dailyDone || []).includes(c));
      if (dupQ.length && !confirm('이 현장의 ' + nm(dupQ) + '은(는) 이미 예약해 둔 글이 있어요.\n같은 품목으로 또 올릴까요?')) return;
      if (dupD.length && !confirm('이 현장의 ' + nm(dupD) + '은(는) 이미 인스타에 올린 걸로 기록돼 있어요' + (dupD.some(c => (f.dailyPending || []).includes(c)) ? ' (시트 반영 대기 포함)' : '') + '.\n같은 품목으로 또 올릴까요?')) return;
    }
    const date = now ? ymd(new Date()) : ($('igDate').value || nextFreeDay());
    if (now) {
      if (!confirm('지금 바로 인스타에 올릴까요?\n캡션과 사진이 맞는지 미리보기를 한 번 더 확인해 주세요.' + ($('igStory').checked ? '\n올린 뒤 스토리에도 공유돼요.' : ''))) return;
    } else {
      const same = IG.queue.find(p => p.status !== '게시 완료' && p.scheduledDate === date);
      if (same && !confirm(fmtD(date) + '에는 이미 예약된 글(' + (same.hashtag || same.apt) + ')이 있어요. 하루에 한 개씩 올라가서 이 글은 그다음 빈 날에 올라갈 수 있어요. 그대로 예약할까요?')) return;
    }
    $('igSave').disabled = $('igNow').disabled = true;
    try {
      const images = [];
      for (let i = 0; i < IG.crops.length; i++) { setStatus('igSaveStatus', `${IG.ratio}로 자르는 중 ${i + 1}/${IG.crops.length}`); images.push(await cropJpeg(IG.crops[i])); }
      const story = $('igStory').checked ? await storyJpeg(images[0]) : null;
      setStatus('igSaveStatus', '구글 드라이브 폴더에 넣는 중…');
      const s = IG.site, seoul = isSeoul();
      const post = {
        apt, hashtag: tagOf(apt), body, caption: fullText(), scheduledDate: date, seoul, hashtagComment: seoul ? tagOf(apt) : null,
        credit: $('igCredit').value.trim() || null, interior: handleOf($('igInterior').value) || null, tones: [...IG.tones], memo: $('igMemo').value.trim(), feedback: IG.feedback,
        siteName: s ? s.name : null, sheetTab: s ? s.tab : null, sheetRow: s ? s.row : null, items: [...IG.items], postNow: !!now, ratio: IG.ratio
      };
      rememberInterior(IG.company, post.interior);
      const qr = await api('/api/insta/queue', { post, images, story });
      IG.memory.confirmed = [body, ...(IG.memory.confirmed || [])]; api('/api/insta/memory', { confirmed: body }).catch(() => {});
      $('igDate').value = '';
      setStatus('igSaveStatus', now
        ? (qr && qr.fire
          ? '바로 발행을 요청했어요. 1분쯤 뒤에 발행 작업이 바로 시작돼요 (정해 둔 시간을 기다리지 않아요). 보통 3~5분 안에 올라가고, 올라가면 아래 목록이 \'게시 완료\'로 바뀌어요.'
          : '바로 발행을 요청했어요. 구글 드라이브가 사진을 올린 뒤, 한 시간에 한 번(매시 5분) 확인해서 올려요 — 최대 1시간.\n바로 시작하게 하려면 [인스타 연결 설정]에서 \'바로 발행 즉시 실행\'을 한 번 설정해 두세요. 더 급하면 Claude 대화에서 \'올려줘\'라고 하세요. 올라가면 아래 목록이 \'게시 완료\'로 바뀌어요.')
        : `예약했어요. ${fmtD(date)} 아침 9시쯤 자동으로 올라가요.\n구글 드라이브가 사진을 올리는 데 몇 분 걸릴 수 있어요 (드라이브 앱이 켜져 있어야 해요).`, 'ok');
      loadQueue(); loadSites();
    } catch (e) { setStatus('igSaveStatus', e.message, 'error'); }
    finally { $('igSave').disabled = $('igNow').disabled = false; }
  };
  $('igSave').addEventListener('click', () => save(false));
  $('igNow').addEventListener('click', () => save(true));
  $('igQueue').addEventListener('change', async e => {
    if (!e.target.dataset.date) return; const id = e.target.closest('.qitem').dataset.id;
    try { await api('/api/insta/queue/update', { id, scheduledDate: e.target.value }); toast('날짜를 ' + fmtD(e.target.value) + '로 바꿨어요.', 'ok'); loadQueue(); } catch (er) { toast(er.message, 'error'); }
  });
  $('igQueue').addEventListener('click', async e => {
    const it = e.target.closest('.qitem'); if (!it) return; const p = IG.queue.find(x => x.id === it.dataset.id); if (!p) return;
    if (e.target.dataset.copy) { await KK.copy(p.caption); toast('글을 복사했어요.', 'ok'); }
    if (e.target.dataset.dl) { const a = document.createElement('a'); a.href = '/api/insta/qzip?id=' + encodeURIComponent(p.id); a.download = ''; document.body.appendChild(a); a.click(); a.remove(); toast('사진·글 zip을 받는 중이에요. 받은 파일을 풀어서 인스타에 올리세요.', 'ok'); }
    if (e.target.dataset.now && confirm('이 글을 지금 바로 올릴까요?' + (IG.conn && IG.conn.fire && IG.conn.fire.on ? ' 1분쯤 뒤에 발행 작업이 바로 시작돼요.' : ' 즉시 실행을 설정하지 않았으면 다음 확인 때(매시 5분) 올라가요.'))) { try { const ur = await api('/api/insta/queue/update', { id: p.id, postNow: true }); toast(ur.fire ? '바로 발행을 요청했어요. 곧 발행 작업이 시작돼요.' : '바로 발행을 요청했어요. 다음 확인 때 올라가요.', 'ok'); loadQueue(); } catch (er) { toast(er.message, 'error'); } }
    if (e.target.dataset.del && confirm('이 예약을 취소할까요? 드라이브 폴더에서 사진과 글이 지워져요.')) { try { await api('/api/insta/queue/remove', { id: p.id }); loadQueue(); loadSites(); } catch (er) { toast(er.message, 'error'); } }
  });
  $('igQueueReload').addEventListener('click', loadQueue);
  $('setSave').addEventListener('click', async () => {
    try { await api('/api/insta/settings', { sheetPath: $('setSheet').value, photoRoot: $('setPhoto').value, queueDir: $('setQueue').value, fireId: $('setFireId').value, fireToken: $('setFireToken').value }); toast('저장했어요.', 'ok'); await refreshConn(); loadSites(true); loadQueue(); }
    catch (e) { toast(e.message, 'error'); }
  });
  $('setFireTest').addEventListener('click', async () => {
    try {
      await api('/api/insta/settings', { fireId: $('setFireId').value, fireToken: $('setFireToken').value });
      const r = await api('/api/insta/fire-test', {}); showFire(r.fire); toast(r.fire.last && r.fire.last.ok ? '연결됐어요. 발행 작업이 시작됐어요 (요청이 없으니 바로 끝나요).' : '연결을 확인해 주세요: ' + ((r.fire.last && r.fire.last.why) || ''), r.fire.last && r.fire.last.ok ? 'ok' : 'error');
    } catch (e) { toast(e.message, 'error'); }
  });
  $('setFind').addEventListener('click', async () => { $('setQueue').value = ''; await api('/api/insta/settings', { queueDir: '' }).catch(() => {}); refreshConn(); loadQueue(); });
  api('/api/insta/memory').then(m => { IG.memory = m; }).catch(() => {});
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelector('.hub-tabs').addEventListener('click', e => { const b = e.target.closest('[data-hub]'); if (b) show(b.dataset.hub); });
  initSites(); initInsta(); initIgToken(); initBlogRec(); initMark();
  let t = 'blog'; try { t = localStorage.getItem('kk-hub-tab') || 'blog'; } catch (_) {}
  show(t);
  // 예약 수 표시용
  api('/api/insta/queue').then(j => { IG.queue = j.posts; $('igQueueTab').textContent = IG.queue.filter(p => p.status !== '게시 완료').length || ''; }).catch(() => {});
});
})();
