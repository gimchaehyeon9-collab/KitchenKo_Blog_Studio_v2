/**
 * 블로그 관리 알바 작업시트 연결 (Apps Script 웹앱) — 레몬하우스 + 키친앤코 공용
 *
 * 스튜디오가 네이버에 글을 임시저장하면(또는 [시트에 기록]을 누르면) 이 스크립트가 시트에 한 줄을 적어 줘요.
 *
 *  ■ 레몬하우스  → 내 블로그 탭 (예: 9번(ktjkde0610))
 *     열: 포스팅 날짜 | 현장명(인텍) | 추천글 현장 | 지역 | 키워드 | … | 링크
 *     · 그 날짜 줄이 이미 있고 비어 있으면 그 줄을 채우고,
 *     · 이미 채워져 있으면 그 날짜 줄 바로 아래에 새 줄을 넣고,
 *     · 그 날짜 줄이 없으면 날짜 순서에 맞는 자리에 새 줄을 넣어요.
 *     · 같은 날짜·같은 추천글 현장이 이미 있으면 새 줄을 만들지 않고 그 줄을 그대로 둬요(중복 방지).
 *
 *  ■ 키친앤코    → '키친앤코' 탭 (왼쪽 첫 표: 포스팅 날짜 | 현장명 | 품목 | 키워드 | 순위 | 링크)
 *     · 오른쪽에 다른 달 표가 붙어 있어서 줄을 끼워 넣지 않고, 표 맨 아래 빈 줄에 이어서 적어요.
 *     · 날짜가 이미 있는 줄 사이로 끼워야 할 때만 그 표(A:F)만 한 칸씩 아래로 밀어요.
 *     · 순위 칸은 건드리지 않아요(알바님이 적는 칸). 링크는 발행한 글 주소를 알 때만 적어요.
 *     · 같은 현장·같은 품목이 최근(7일 안)에 이미 있으면 새 줄을 만들지 않고 비어 있는 링크·키워드만 채워요.
 *
 * 설치(처음 한 번) / 업데이트는 같은 방법이에요 — 시트 편집 권한이 있는 계정으로:
 *   1) 블로그 관리 시트 열기 → [확장 프로그램] → [Apps Script]
 *   2) 기존 코드를 지우고 이 파일 내용을 전부 붙여넣기 → 저장
 *   3) 이미 배포해 둔 적이 있으면: [배포] → [배포 관리] → 연필(수정) → 버전: '새 버전' → [배포]
 *      처음이면: [배포] → [새 배포] → 유형: 웹 앱 → 다음 사용자로 실행: 나 / 액세스 권한: 모든 사용자 → [배포] → 권한 승인
 *      → '웹 앱 URL' 복사 (업데이트할 때는 URL이 그대로예요)
 *   4) 스튜디오의 [연결 설정]에 URL과 같은 비밀번호(KEY)를 넣고 저장 → [시트 연결 확인]
 */

const SHEET_ID = '1b35M3kgfvXJgzkb9xns7tNIHXl0TZNUFSafpqSCwlUA';   // 블로그 관리 알바 작업시트
const KEY = '여기에-비밀번호를-적으세요';                              // 스튜디오 [연결 설정]의 '시트 연결 비밀번호'와 같게
const KITCHEN_TAB = '키친앤코';

function doGet() { return out_({ ok: true, ping: '블로그 시트 연결 OK (레몬하우스 · 키친앤코)', v: 3, brands: ['lemon', 'kitchenko'], rank: true }); }

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const req = JSON.parse(e.postData.contents);
    if (KEY && req.key !== KEY) return out_({ ok: false, error: '시트 연결 비밀번호가 달라요. 스튜디오 [연결 설정]과 스크립트의 KEY를 같게 맞춰 주세요.' });
    const ss = SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActive();
    if (req.brand === 'kitchenko' && req.action === 'pending') return out_(pendingKitchen_(ss, req));
    if (req.brand === 'kitchenko' && req.action === 'fill') return out_(fillKitchen_(ss, req));
    return out_(req.brand === 'kitchenko' ? writeKitchen_(ss, req) : writeLemon_(ss, req));
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function setLink_(range, url) {
  range.setRichTextValue(SpreadsheetApp.newRichTextValue().setText(url).setLinkUrl(url).build());
}

/* ───────── 레몬하우스 ───────── */
function writeLemon_(ss, req) {
  const sh = findTab_(ss, req);
  const values = sh.getDataRange().getDisplayValues();
  const plan = planRow_(values, req);
  const c = plan.cols;                      // 1부터 시작하는 열 번호
  if (plan.mode === 'same') {
    // 이미 같은 글이 적혀 있음 — 비어 있는 지역·키워드·링크만 채움
    const kept = [];
    if (req.region && !plan.existing.region) sh.getRange(plan.row, c.region).setValue(req.region);
    if (req.keywords && !plan.existing.kw) sh.getRange(plan.row, c.kw).setValue(req.keywords);
    if (req.link && c.link && !plan.existing.link) setLink_(sh.getRange(plan.row, c.link), req.link);
    SpreadsheetApp.flush();
    return { ok: true, tab: sh.getName(), row: plan.row, mode: 'same', kept: kept, keptValues: {} };
  }
  let row = plan.row;                       // 1부터 시작하는 시트 행 번호
  if (plan.mode === 'insert') sh.insertRowAfter(row - 1);   // 위 줄의 서식을 이어받는 빈 줄
  sh.getRange(row, c.date).setNumberFormat('@').setValue(req.date);
  sh.getRange(row, c.site).setValue(req.site);
  sh.getRange(row, c.apt).setValue(req.apt);
  // 지역·키워드 칸에 담당자가 미리 적어 둔 내용이 있으면 덮어쓰지 않고 그대로 둠
  const kept = [];
  if (req.region) { if (plan.existing.region) kept.push('지역'); else sh.getRange(row, c.region).setValue(req.region); }
  if (req.keywords) { if (plan.existing.kw) kept.push('키워드'); else sh.getRange(row, c.kw).setValue(req.keywords); }
  if (req.link && c.link) setLink_(sh.getRange(row, c.link), req.link);
  SpreadsheetApp.flush();
  return { ok: true, tab: sh.getName(), row: row, mode: plan.mode, kept: kept, keptValues: kept.length ? { 지역: plan.existing.region, 키워드: plan.existing.kw } : {} };
}

// 내 블로그 탭 찾기: 탭 이름 그대로 → '9번…' / '메인…' → 블로그 아이디가 들어 있는 탭
function findTab_(ss, req) {
  let sh = ss.getSheetByName(req.tab);
  if (sh) return sh;
  const sheets = ss.getSheets(), key = String(req.blogKey || '');
  sh = sheets.filter(function (s) { const n = s.getName(); return key === '메인' ? n.indexOf('메인') === 0 : new RegExp('^' + key + '번').test(n); })[0];
  if (sh) return sh;
  const id = String(req.blogId || '').toLowerCase().replace(/^lemon/, '');
  if (id.length >= 4) sh = sheets.filter(function (s) { return s.getName().toLowerCase().indexOf(id) >= 0; })[0];
  if (!sh) throw new Error('시트에서 내 블로그 탭을 찾지 못했어요: ' + req.tab);
  return sh;
}

// '26.10.27' 형태로 통일 ('2026-10-27', '26.10.27.', '26. 10. 27' 도 같은 날짜로 봄)
function normDate_(v) {
  const t = String(v == null ? '' : v).trim();
  let m = /^(\d{4})[-./]\s*(\d{1,2})[-./]\s*(\d{1,2})/.exec(t);
  if (m) return m[1].slice(2) + '.' + ('0' + m[2]).slice(-2) + '.' + ('0' + m[3]).slice(-2);
  m = /^(\d{2})[-./]\s*(\d{1,2})[-./]\s*(\d{1,2})(?!\d)/.exec(t);
  if (m) return m[1] + '.' + ('0' + m[2]).slice(-2) + '.' + ('0' + m[3]).slice(-2);
  return '';
}
// 글자 비교용: 공백·점·쉼표·괄호·밑줄 등을 없애고 소문자로
function key_(s) { return String(s == null ? '' : s).replace(/[\s.,_\-~·()\/]/g, '').toLowerCase(); }
// 'YY.MM.DD' 두 날짜 사이의 일수 (a - b)
function dayDiff_(a, b) {
  const p = function (s) { const m = /^(\d{2})\.(\d{2})\.(\d{2})$/.exec(s); return m ? Date.UTC(2000 + +m[1], +m[2] - 1, +m[3]) / 864e5 : NaN; };
  return p(a) - p(b);
}

// 레몬: 어느 행에 쓸지 정하는 부분 (시트를 직접 만지지 않는 순수 함수 — 시험하기 쉽게 분리)
// values: 시트에 보이는 값 2차원 배열(0부터), 결과의 row/cols는 시트 번호(1부터)
function planRow_(values, req) {
  const norm = function (s) { return String(s == null ? '' : s).replace(/\s+/g, ''); };
  let hr = -1, dc = -1;
  for (let r = 0; r < Math.min(values.length, 30) && hr < 0; r++) {
    for (let c = 0; c < values[r].length; c++) if (norm(values[r][c]) === '포스팅날짜') { hr = r; dc = c; break; }
  }
  if (hr < 0) throw new Error('이 탭에서 "포스팅 날짜" 제목 줄을 찾지 못했어요.');
  const head = values[hr].map(norm);
  const find = function (test, fallback) { const i = head.findIndex(test); return i >= 0 ? i : fallback; };
  const cols0 = {
    date: dc,
    site: find(function (h) { return h.indexOf('현장명') === 0; }, dc + 1),
    apt: find(function (h) { return h.indexOf('추천글') >= 0 && h.indexOf('현장') >= 0; }, dc + 2),
    region: find(function (h) { return h === '지역' || h === '컨텐츠'; }, dc + 3),
    kw: find(function (h) { return h.indexOf('키워드') === 0; }, dc + 4),
    link: find(function (h) { return h === '링크'; }, -1)
  };
  const cols = { date: cols0.date + 1, site: cols0.site + 1, apt: cols0.apt + 1, region: cols0.region + 1, kw: cols0.kw + 1, link: cols0.link >= 0 ? cols0.link + 1 : 0 };
  const cell = function (r, c) { return norm(values[r] && values[r][c]); };
  const raw = function (r, c) { return c >= 0 ? String(values[r] && values[r][c] || '').trim() : ''; };

  const want = normDate_(req.date);
  if (!want) throw new Error('포스팅 날짜 형식이 올바르지 않아요: ' + req.date);
  let lastDated = hr, firstAfter = -1, same = [];
  for (let r = hr + 1; r < values.length; r++) {
    const d = normDate_(values[r][dc]);
    if (!d) continue;
    lastDated = r;
    if (d === want) same.push(r);
    else if (d > want && firstAfter < 0) firstAfter = r;
  }
  const none = { region: '', kw: '', link: '' };
  // 0) 같은 날짜에 같은 추천글 현장이 이미 있으면 새 줄을 만들지 않음 (임시저장을 다시 하거나 [시트에 기록]을 또 눌러도 한 줄만)
  const aptKey = key_(req.apt);
  if (aptKey) for (let i = 0; i < same.length; i++) {
    const r = same[i];
    if (key_(values[r][cols0.apt]) === aptKey) return { mode: 'same', row: r + 1, cols: cols, existing: { region: raw(r, cols0.region), kw: raw(r, cols0.kw), link: raw(r, cols0.link) } };
  }
  // 1) 그 날짜 줄에서 현장명·추천글 현장이 비어 있으면 그 줄을 채움 (지역·키워드는 담당자가 미리 적어 둘 수 있어 따로 봄)
  for (let i = 0; i < same.length; i++) {
    const r = same[i];
    if (!cell(r, cols0.site) && !cell(r, cols0.apt)) return { mode: 'fill', row: r + 1, cols: cols, existing: { region: raw(r, cols0.region), kw: raw(r, cols0.kw), link: raw(r, cols0.link) } };
  }
  // 2) 같은 날짜 줄이 이미 차 있으면 그 아래에 새 줄
  if (same.length) return { mode: 'insert', row: same[same.length - 1] + 2, cols: cols, existing: none };
  // 3) 날짜 순서에 맞는 자리 (뒤에 더 늦은 날짜가 있으면 그 앞, 없으면 마지막 날짜 줄 아래)
  if (firstAfter >= 0) return { mode: 'insert', row: firstAfter + 1, cols: cols, existing: none };
  return { mode: 'insert', row: lastDated + 2, cols: cols, existing: none };
}

/* ───────── 키친앤코 ───────── */
function writeKitchen_(ss, req) {
  const sh = ss.getSheetByName(req.tab || KITCHEN_TAB);
  if (!sh) throw new Error('시트에서 "' + (req.tab || KITCHEN_TAB) + '" 탭을 찾지 못했어요.');
  const values = sh.getDataRange().getDisplayValues();
  const plan = planKitchen_(values, req);
  const c = plan.cols;                       // 1부터 시작하는 열 번호
  if (plan.mode === 'same') {
    if (req.keywords && !plan.existing.kw) sh.getRange(plan.row, c.kw).setValue(req.keywords);
    if (req.link && !plan.existing.link) setLink_(sh.getRange(plan.row, c.link), req.link);
    SpreadsheetApp.flush();
    return { ok: true, tab: sh.getName(), row: plan.row, mode: 'same', linked: !!(req.link && !plan.existing.link) };
  }
  const row = plan.row, span = c.link - c.date + 1;
  if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), row - sh.getMaxRows() + 10);
  if (plan.mode === 'shift') {
    // 날짜 순서 중간에 끼우기: 이 표(A:F 열)만 아래로 한 칸 밀어요. 옆의 다른 달 표는 그대로 있어요.
    sh.getRange(row, c.date, plan.lastUsed - row + 1, span).moveTo(sh.getRange(row + 1, c.date));
  }
  if (plan.mode !== 'fill' && row > 1) sh.getRange(row - 1, c.date, 1, span).copyTo(sh.getRange(row, c.date, 1, span), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  const rng = function (col) { return sh.getRange(row, col); };
  rng(c.date).setNumberFormat('@').setValue(req.date);
  if (plan.mode === 'fill') {
    if (req.site && !plan.existing.site) rng(c.site).setValue(req.site);
    if (req.item && !plan.existing.item) rng(c.item).setValue(req.item);
    if (req.keywords && !plan.existing.kw) rng(c.kw).setValue(req.keywords);
    if (req.link && !plan.existing.link) setLink_(rng(c.link), req.link);
  } else {
    rng(c.site).setValue(req.site || '');
    rng(c.item).setValue(req.item || '');
    rng(c.kw).setValue(req.keywords || '');
    if (req.link) setLink_(rng(c.link), req.link);
  }
  SpreadsheetApp.flush();
  return { ok: true, tab: sh.getName(), row: row, mode: plan.mode, linked: !!req.link };
}

// 키친앤코 탭에서 어느 행에 쓸지 정하는 순수 함수 (시험하기 쉽게 분리)
// 첫 번째 표(포스팅 날짜 | 현장명 | 품목 | 키워드 | 순위 | 링크)만 봐요. 오른쪽 다른 달 표는 무시.
function planKitchen_(values, req) {
  const norm = function (s) { return String(s == null ? '' : s).replace(/\s+/g, ''); };
  let hr = -1, dc = -1;
  for (let r = 0; r < Math.min(values.length, 30) && hr < 0; r++) {
    const row = values[r] || [];
    for (let c = 0; c + 1 < row.length; c++) if (norm(row[c]) === '포스팅날짜' && norm(row[c + 1]) === '현장명') { hr = r; dc = c; break; }
  }
  if (hr < 0) throw new Error('이 탭에서 "포스팅 날짜 | 현장명" 제목 줄을 찾지 못했어요.');
  const head = (values[hr] || []).map(norm);
  const at = function (name, fb) { for (let i = dc; i < Math.min(head.length, dc + 8); i++) if (head[i] === name) return i; return fb; };
  const cols0 = { date: dc, site: at('현장명', dc + 1), item: at('품목', dc + 2), kw: at('키워드', dc + 3), rank: at('순위', dc + 4), link: at('링크', dc + 5) };
  const cols = { date: cols0.date + 1, site: cols0.site + 1, item: cols0.item + 1, kw: cols0.kw + 1, rank: cols0.rank + 1, link: cols0.link + 1 };
  const last0 = Math.max(cols0.site, cols0.item, cols0.kw, cols0.rank, cols0.link);
  const raw = function (r, c) { return String(values[r] && values[r][c] || '').trim(); };
  const used = function (r) { for (let c = dc; c <= last0; c++) if (raw(r, c)) return true; return false; };

  const want = normDate_(req.date);
  if (!want) throw new Error('포스팅 날짜 형식이 올바르지 않아요: ' + req.date);
  let lastUsed = hr, lastDated = -1, lastDate = '';
  for (let r = hr + 1; r < values.length; r++) {
    if (!used(r)) continue;
    lastUsed = r;
    const d = normDate_(raw(r, dc));
    if (d) { lastDated = r; if (d > lastDate) lastDate = d; }
  }
  const ex = function (r) { return { site: raw(r, cols0.site), item: raw(r, cols0.item), kw: raw(r, cols0.kw), link: raw(r, cols0.link) }; };
  const siteKey = key_(req.site), itemKey = key_(req.item);

  // 0) 같은 현장·같은 품목이 최근 7일 안에 이미 있으면 새 줄을 만들지 않음 (임시저장 다시 하기 · 발행 뒤 링크 채우기)
  for (let r = lastUsed; r > hr && r > lastUsed - 80; r--) {
    if (!used(r)) continue;
    const d = normDate_(raw(r, dc));
    if (d) { const gap = dayDiff_(want, d); if (!(gap >= -7 && gap <= 7)) continue; }
    const sk = key_(raw(r, cols0.site)), ik = key_(raw(r, cols0.item));
    if (siteKey && sk && sk === siteKey && ik === itemKey) return { mode: 'same', row: r + 1, cols: cols, lastUsed: lastUsed + 1, existing: ex(r) };
  }
  // 1) 그 날짜가 미리 적혀 있고 나머지가 빈 줄이면 그 줄을 채움
  for (let r = hr + 1; r < values.length; r++) {
    if (normDate_(raw(r, dc)) === want && !raw(r, cols0.site) && !raw(r, cols0.item) && !raw(r, cols0.kw) && !raw(r, cols0.link)) return { mode: 'fill', row: r + 1, cols: cols, lastUsed: lastUsed + 1, existing: ex(r) };
  }
  // 2) 가장 늦은 날짜보다 같거나 늦으면 표 맨 아래에 이어 쓰기
  if (!lastDate || want >= lastDate) return { mode: 'append', row: lastUsed + 2, cols: cols, lastUsed: lastUsed + 1, existing: { site: '', item: '', kw: '', link: '' } };
  // 3) 더 이른 날짜면 날짜 순서에 맞는 자리에 끼움 (이 표만 아래로 밀기)
  let p = hr;
  for (let r = hr + 1; r <= lastUsed; r++) { const d = normDate_(raw(r, dc)); if (d && d <= want) p = r; }
  return { mode: 'shift', row: p + 2, cols: cols, lastUsed: lastUsed + 1, existing: { site: '', item: '', kw: '', link: '' } };
}


/* ───────── 키친앤코: 어제 글 링크·순위 채우기 (스튜디오가 네이버에서 가져온 값을 적어요) ───────── */
// 첫 번째 표(포스팅 날짜 | 현장명 | 품목 | 키워드 | 순위 | 링크)의 열 위치
function kitchenTable_(values) {
  const norm = function (s) { return String(s == null ? '' : s).replace(/\s+/g, ''); };
  let hr = -1, dc = -1;
  for (let r = 0; r < Math.min(values.length, 30) && hr < 0; r++) {
    const row = values[r] || [];
    for (let c = 0; c + 1 < row.length; c++) if (norm(row[c]) === '포스팅날짜' && norm(row[c + 1]) === '현장명') { hr = r; dc = c; break; }
  }
  if (hr < 0) throw new Error('이 탭에서 "포스팅 날짜 | 현장명" 제목 줄을 찾지 못했어요.');
  const head = (values[hr] || []).map(norm);
  const at = function (name, fb) { for (let i = dc; i < Math.min(head.length, dc + 8); i++) if (head[i] === name) return i; return fb; };
  return { hr: hr, dc: dc, site: at('현장명', dc + 1), item: at('품목', dc + 2), kw: at('키워드', dc + 3), rank: at('순위', dc + 4), link: at('링크', dc + 5) };
}
// 링크나 순위가 비어 있는, 어제 이전(최근 maxDays일) 글의 줄 목록
function pendingKitchen_(ss, req) {
  const sh = ss.getSheetByName(req.tab || KITCHEN_TAB);
  if (!sh) throw new Error('시트에서 "' + (req.tab || KITCHEN_TAB) + '" 탭을 찾지 못했어요.');
  const values = sh.getDataRange().getDisplayValues();
  const t = kitchenTable_(values);
  const today = normDate_(req.today);
  if (!today) throw new Error('오늘 날짜 형식이 올바르지 않아요: ' + req.today);
  const maxDays = Math.min(Math.max(Number(req.maxDays) || 14, 1), 60);
  const raw = function (r, c) { return String(values[r] && values[r][c] || '').trim(); };
  const rows = [];
  for (let r = t.hr + 1; r < values.length; r++) {
    const d = normDate_(raw(r, t.dc));
    if (!d) continue;
    const gap = dayDiff_(today, d);
    if (!(gap >= 1 && gap <= maxDays)) continue;           // 오늘 올린 글은 아직 안 봐요 (다음 날부터)
    if (!raw(r, t.site)) continue;
    const link = raw(r, t.link), rank = raw(r, t.rank);
    if (link && rank) continue;
    rows.push({ row: r + 1, date: d, site: raw(r, t.site), item: raw(r, t.item), kw: raw(r, t.kw), link: link, rank: rank });
  }
  return { ok: true, tab: sh.getName(), rows: rows };
}
// 한 줄에 링크·순위 적기 (이미 적혀 있는 칸은 덮어쓰지 않고, 그 사이 행이 밀렸으면 쓰지 않아요)
function fillKitchen_(ss, req) {
  const sh = ss.getSheetByName(req.tab || KITCHEN_TAB);
  if (!sh) throw new Error('시트에서 "' + (req.tab || KITCHEN_TAB) + '" 탭을 찾지 못했어요.');
  const values = sh.getDataRange().getDisplayValues();
  const t = kitchenTable_(values);
  const r = Number(req.row) - 1;
  if (!(r > t.hr && r < values.length)) throw new Error('행 번호가 올바르지 않아요: ' + req.row);
  const raw = function (c) { return String(values[r][c] || '').trim(); };
  if (normDate_(raw(t.dc)) !== normDate_(req.expectDate) || key_(raw(t.site)) !== key_(req.expectSite)) throw new Error('그 사이 줄이 바뀌었어요 (' + req.row + '행). 다시 시도해 주세요.');
  let linked = false, ranked = false;
  if (req.link && !raw(t.link)) { setLink_(sh.getRange(r + 1, t.link + 1), String(req.link)); linked = true; }
  if (req.rank && !raw(t.rank)) { sh.getRange(r + 1, t.rank + 1).setNumberFormat('@').setValue(String(req.rank)); ranked = true; }
  SpreadsheetApp.flush();
  return { ok: true, tab: sh.getName(), row: r + 1, linked: linked, ranked: ranked };
}
