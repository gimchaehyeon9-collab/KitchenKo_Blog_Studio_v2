// 키친앤코 스튜디오 — 블로그 링크 · 네이버 노출 순위 기록 (2.10.16 · 2.10.28 API HUB · 2.10.29 블로그탭 검색)
// 다음 날이 되면, 구글 '블로그 관리 알바 작업시트'의 [키친앤코] 탭에서 링크·순위가 비어 있는 전날(이전) 글 줄을 찾아
//   · 링크: 사장님 네이버 블로그 RSS에서 그날 올린 글을 제목으로 찾아 채우고
//   · 순위: 네이버 통합검색 '블로그탭'(blog-exposure-check 프로그램과 같은 방식, API 키 불필요) 상위 20위 안에서
//     '키워드A / 키워드B' 각각의 순위를 찾아 "15 / 2" 모양으로 채웁니다 (20위 안에 없으면 "-")
//     (API HUB·예전 개발자센터 키로 조회하는 방식도 설정에서 고를 수 있어요)
// 이미 적혀 있는 칸은 덮어쓰지 않아요.
// 2.10.36 — 레몬하우스도: 고른 '내 블로그' 탭에서 순위 칸(순위·노출·D+1)이 빈 전날 글을 찾아 키워드(최대 3개)별 순위를 채워요.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const lemon = require('./lemon.js');

const KEY_DIR = path.join(os.homedir(), '.kitchenko-studio');
const SET_FILE = path.join(KEY_DIR, 'rank-settings.json');
const MASK = '●●●●●●●●';
const DEFAULTS = { naverId: '', naverSecret: '', provider: 'tab', blogId: 'kitchennko', daysBack: 14, depth: 300 };
// provider: 'tab' = 네이버 통합검색 블로그탭(2.10.29~ 기본, 키 없음) · 'hub' = NAVER API HUB 키 · 'legacy' = 예전 개발자센터 키(신규 발급 종료)
const TAB_DEPTH = 20, TAB_DELAY_MS = 2500;      // blog-exposure-check 의 RANK_DEPTH · DELAY_MS 와 같은 값 (네이버가 막지 않도록 요청 사이를 쉼)
const TAB_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
async function readJson(req, cap) {
  const chunks = []; let n = 0;
  for await (const ch of req) { n += ch.length; if (n > cap) throw Error('전송 용량이 너무 큽니다.'); chunks.push(ch); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
function readRaw() { try { return JSON.parse(fs.readFileSync(SET_FILE, 'utf8')); } catch (_) { return {}; } }
function readSettings() {
  const raw = readRaw(), s = { ...DEFAULTS, ...raw };
  s.depth = Math.min(Math.max(Number(s.depth) || 300, 100), 1000);
  // 예전에 개발자센터 키를 저장해 둔 분은 그대로 예전 주소를 계속 써요 (provider를 따로 고르기 전까지)
  s.provider = s.provider === 'legacy' || s.provider === 'hub' || s.provider === 'tab' ? s.provider : 'tab';
  if (!raw.provider && raw.naverId) s.provider = 'legacy';
  return s;
}

// ── 글자·주소·날짜 도우미 (시험하기 쉽게 따로 둠) ──
const key_ = s => String(s == null ? '' : s).replace(/[\s.,_\-~·()\/\[\]|:]/g, '').toLowerCase();
const unesc = s => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&').replace(/<[^>]+>/g, '').trim();
const logNoOf = link => { const m = /logNo=(\d{6,})/i.exec(link || '') || /blog\.naver\.com\/[^/?#]+\/(\d{6,})/i.exec(link || '') || /\/(\d{9,})(?:[?#]|$)/.exec(link || ''); return m ? m[1] : ''; };
const kstDay = ms => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);          // 'YYYY-MM-DD' (한국 날짜)
const sheetDay = d => { const m = /^(\d{2})\.(\d{2})\.(\d{2})$/.exec(String(d || '').trim()); return m ? '20' + m[1] + '-' + m[2] + '-' + m[3] : ''; };   // '26.11.12' → '2026-11-12'
const toSheetDay = ymd => ymd.slice(2).replace(/-/g, '.');                              // '2026-11-13' → '26.11.13'
function splitKw(kw) { return String(kw || '').split(/\s*\/\s*/).map(s => s.trim()).filter(Boolean); }

// 네이버 블로그 RSS → [{title, link, logNo, day}]
function parseRss(xml) {
  const out = [];
  for (const m of String(xml || '').matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const f = tag => { const x = new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>', 'i').exec(m[1]); return x ? unesc(x[1]) : ''; };
    const link = f('link'), t = Date.parse(f('pubDate'));
    if (!link || isNaN(t)) continue;
    out.push({ title: f('title'), link, logNo: logNoOf(link), day: kstDay(t) });
  }
  return out;
}
// 시트 한 줄(날짜·현장명·키워드)에 맞는 글 찾기: 그날 올라온 글 중 제목에 현장명·키워드가 들어간 것
function matchPost(row, items) {
  const day = sheetDay(row.date), same = items.filter(i => i.day === day && i.logNo);
  if (!same.length) return { item: null, why: '그날(' + row.date + ') 올라온 글을 블로그 RSS에서 찾지 못했어요' };
  const sk = key_(row.site), kws = splitKw(row.kw).map(key_).filter(Boolean);
  const score = i => { const t = key_(i.title); let s = 0; if (sk && t.includes(sk)) s += 3; for (const k of kws) if (k && t.includes(k)) s += 2; return s; };
  const ranked = same.map(i => [score(i), i]).sort((a, b) => b[0] - a[0] || a[1].logNo - b[1].logNo);
  if (ranked[0][0] < 2) return { item: null, why: '그날 글은 있지만 제목에서 현장명·키워드를 찾지 못해 어느 글인지 정하지 않았어요' };
  if (ranked.length > 1 && ranked[1][0] === ranked[0][0]) return { item: null, why: '같은 날 비슷한 글이 둘 이상이라 어느 글인지 정하지 않았어요' };
  return { item: ranked[0][1] };
}
// ── 네이버 통합검색 '블로그탭' 순위 (blog-exposure-check/collect.mjs 의 findRank 와 같은 방식) ──
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function tabGet(url, fetchFn, tries = 3) {
  const f = fetchFn || fetch;
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await f(url, { headers: { 'User-Agent': TAB_UA, 'Accept-Language': 'ko-KR,ko;q=0.9', 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Referer': 'https://search.naver.com/' }, signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.text();
    } catch (err) {
      if (i === tries) throw err;
      await sleep(TAB_DELAY_MS * i * 2);        // 차단이 의심되면 점점 더 오래 쉰다
    }
  }
}
/** 검색결과 HTML에서 blog.naver.com 글 링크를 나온 순서대로 뽑아 중복을 없앤다 → ['블로그id/글번호', …] */
function resultKeys(html) {
  const seen = new Set(), out = [];
  for (const m of String(html || '').matchAll(/https?:\/\/(?:m\.)?blog\.naver\.com\/[^"'\s\\<>]+/g)) {
    const url = m[0];
    let hit = url.match(/blog\.naver\.com\/([A-Za-z0-9_-]+)\/(\d{6,})/);
    if (!hit) hit = url.match(/blog\.naver\.com\/([A-Za-z0-9_-]+)\?.*?logNo=(\d{6,})/);
    if (!hit) continue;
    const key = hit[1].toLowerCase() + '/' + hit[2];
    if (!seen.has(key)) { seen.add(key); out.push(key); }
  }
  return out;
}
/** 블로그탭을 검색해 postKey('블로그id/글번호') 의 순위를 찾는다. 찾으면 숫자, 20위 안에 없으면 null, 검색 자체가 막히거나 실패하면 오류 */
async function tabRank(query, postKey, fetchFn, depth) {
  const dep = depth || TAB_DEPTH;
  let offset = 0;
  while (offset < dep) {
    const url = 'https://search.naver.com/search.naver?ssc=tab.blog.all&query=' + encodeURIComponent(query) + '&start=' + (offset + 1);
    let html;
    try { html = await tabGet(url, fetchFn); }
    catch (e) { throw Error('네이버 검색 결과를 가져오지 못했어요 (' + (e.message || e) + '). 잠시 뒤 다시 해 주세요. 너무 자주 조회하면 네이버가 막을 수 있어요.'); }
    const keys = resultKeys(html);
    if (!keys.length) { if (offset === 0) throw Error('네이버 검색 결과에서 블로그 글을 읽지 못했어요 (잠시 막혔거나 화면 구조가 바뀌었을 수 있어요).'); return null; }
    const at = keys.slice(0, dep - offset).indexOf(postKey);
    if (at >= 0) return offset + at + 1;
    offset += keys.length;
    if (keys.length < 30) return null;          // 결과가 더 없으면 미노출
    if (offset < dep) await sleep(TAB_DELAY_MS);
  }
  return null;
}

// 네이버 검색 API(블로그, 정확도순)에서 이 글의 순위 (못 찾으면 null)
async function naverRank(st, query, logNo, fetchFn) {
  const f = fetchFn || fetch;
  for (let page = 0; page * 100 < st.depth; page++) {
    const start = page * 100 + 1;
    const hub = st.provider !== 'legacy', qs = '?query=' + encodeURIComponent(query) + '&display=100&start=' + start + '&sort=sim';
    const url = hub ? 'https://naverapihub.apigw.ntruss.com/search/v1/blog' + qs : 'https://openapi.naver.com/v1/search/blog.json' + qs;
    const headers = hub ? { 'X-NCP-APIGW-API-KEY-ID': st.naverId, 'X-NCP-APIGW-API-KEY': st.naverSecret } : { 'X-Naver-Client-Id': st.naverId, 'X-Naver-Client-Secret': st.naverSecret };
    const r = await f(url, { headers, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw Error(r.status === 401 || r.status === 403
      ? (hub ? 'NAVER API HUB 키가 맞지 않거나, 그 Application에 "검색" API가 등록돼 있지 않아요 (' + r.status + ')' : '네이버 검색 API 키가 맞지 않거나 "검색" API 사용이 켜져 있지 않아요 (' + r.status + ')')
      : r.status === 429 ? '네이버 검색 API 호출 한도를 넘었어요. 잠시 뒤 다시 해 주세요.' : '네이버 검색 API 오류 (' + r.status + ')');
    const j = await r.json(), items = j.items || [], idx = items.findIndex(it => logNoOf(it.link) === logNo);
    if (idx >= 0) return start + idx;
    if (items.length < 100 || start + 99 >= Math.min(Number(j.total) || 1000, 1000)) break;
  }
  return null;
}
async function ranksFor(st, row, logNo, fetchFn, blogId, maxKw) {
  const kws = splitKw(row.kw).slice(0, maxKw || 2);
  if (!kws.length) return '';
  const rs = [];
  if (st.provider === 'tab') {
    const key = String(blogId || st.blogId || '').toLowerCase() + '/' + logNo;
    for (const k of kws) {
      if (!fetchFn) await sleep(TAB_DELAY_MS);          // 검색마다 먼저 쉼 (네이버가 막지 않도록, 원본 프로그램과 같음). 시험용 fetch 를 넘기면 건너뜀
      rs.push(await tabRank(k, key, fetchFn));
    }
  } else for (const k of kws) rs.push(await naverRank(st, k, logNo, fetchFn));
  return rs.map(x => x == null ? '-' : String(x)).join(' / ');
}

// ── 시트 연결 (스튜디오 시트 연결 설정을 그대로 씀) ──
async function sheetCtx(minV) {
  const ls = lemon._sheet.readSettings();
  if (!ls.sheetUrl) throw Error('구글 시트 연결 주소가 아직 없어요. 블로그 화면 [시트 연결 설정]에 웹앱 주소를 먼저 넣어 주세요.');
  { const bad = lemon._sheet.sheetUrlProblem(ls.sheetUrl); if (bad) throw Error(bad); }
  let r; try { r = await fetch(ls.sheetUrl, { redirect: 'follow', signal: AbortSignal.timeout(20000) }); } catch (e) { throw Error('시트에 연결하지 못했어요: ' + (e.cause && e.cause.code || e.message)); }
  let j; try { j = JSON.parse(await r.text()); } catch (_) { throw Error('시트 응답을 읽지 못했어요. 웹앱 주소와 배포 설정(액세스: 모든 사용자)을 확인해 주세요.'); }
  if (!(j && j.ok && j.v >= (minV || 3))) throw Error(minV >= 4
    ? '레몬 순위 기록은 새 시트 스크립트(v4)가 있어야 해요. 이 폴더의 ‘블로그시트연결.gs’ 내용으로 바꿔 붙여넣고 [배포 → 배포 관리 → 새 버전]으로 다시 배포해 주세요 (맨 위 KEY는 지금 쓰는 비밀번호 그대로, 웹 앱 주소는 그대로예요).'
    : '시트에 설치된 스크립트가 예전 버전이에요. 2.10.16의 ‘블로그시트연결.gs’ 내용으로 바꿔 붙여넣고 [배포 → 배포 관리 → 새 버전]으로 다시 배포해 주세요 (KEY는 그대로).');
  return ls;
}

async function run(opts) {
  const st = readSettings(), ls = await sheetCtx(), today = toSheetDay(kstDay(Date.now()));
  const pend = await lemon._sheet.postSheet(ls, { brand: 'kitchenko', action: 'pending', tab: '키친앤코', today, maxDays: st.daysBack });
  const rows = pend.rows || [];
  const out = { today, checked: rows.length, results: [], rankOn: st.provider === 'tab' || !!(st.naverId && st.naverSecret) };
  if (!rows.length) return out;
  let items = [];
  try {
    const r = await fetch('https://rss.blog.naver.com/' + encodeURIComponent(st.blogId) + '.xml', { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'Mozilla/5.0 KitchenKoStudio' } });
    if (!r.ok) throw Error('응답 코드 ' + r.status);
    items = parseRss(await r.text());
  } catch (e) { throw Error('네이버 블로그 RSS를 읽지 못했어요: ' + e.message); }
  for (const row of rows) {
    const res = { row: row.row, date: row.date, site: row.site, link: '', rank: '', note: '' };
    try {
      const m = matchPost(row, items);
      const link = row.link || (m.item ? 'https://blog.naver.com/' + st.blogId + '/' + m.item.logNo : '');
      const logNo = row.link ? logNoOf(row.link) : (m.item && m.item.logNo);
      if (!link || !logNo) { res.note = m.why || '링크를 정하지 못했어요'; out.results.push(res); continue; }
      let rank = '', rankErr = '';
      if (!row.rank && out.rankOn && !out.rankFail) {
        try { rank = await ranksFor(st, row, logNo, null, (/blog\.naver\.com\/([A-Za-z0-9_-]+)\//i.exec(link) || [])[1]); }
        catch (e) { rankErr = e.message; out.rankFail = e.message; }     // 키 오류·한도 초과면 나머지 줄은 순위 조회를 건너뛰고 링크만 채워요
      }
      if (opts && opts.dryRun) { res.link = link; res.rank = rank; res.note = '미리보기(시트에 쓰지 않음)'; out.results.push(res); continue; }
      const w = await lemon._sheet.postSheet(ls, { brand: 'kitchenko', action: 'fill', tab: '키친앤코', row: row.row, expectDate: row.date, expectSite: row.site, link: row.link ? '' : link, rank });
      res.link = link; res.rank = rank;
      res.note = [w.linked ? '링크 기록' : '', w.ranked ? '순위 기록' : '', !out.rankOn && !row.rank ? '순위는 API 키가 없어 건너뜀' : '', rankErr ? '순위 조회 실패: ' + rankErr : out.rankFail && !row.rank && !rank ? '순위 조회 건너뜀' : ''].filter(Boolean).join(' · ') || '바꿀 칸 없음';
    } catch (e) { res.note = e.message; }
    out.results.push(res);
  }
  return out;
}

// ── 레몬하우스: 내 블로그 탭의 전날 글 순위 (2.10.36) ──
// 시트 링크 칸에서 블로그 아이디·글번호를 뽑는다. 블로그 글 주소가 아니면(카페 링크·숫자 등) null.
function blogRef(link) {
  const t = String(link || '');
  let m = /blog\.naver\.com\/([A-Za-z0-9_-]+)\/(\d{6,})/i.exec(t);
  if (m) return { id: m[1], logNo: m[2] };
  const a = /blog\.naver\.com\/[^\s]*?[?&]blogId=([A-Za-z0-9_-]+)/i.exec(t), b = /[?&]logNo=(\d{6,})/i.exec(t);
  return a && b ? { id: a[1], logNo: b[1] } : null;
}
async function runLemon(opts) {
  opts = opts || {};
  const st = readSettings();
  const lset = lemon._sheet.readSettings();
  const b = lemon.BLOGS.find(x => x.key === String(opts.blogKey || lset.myBlog || ''));
  if (opts.auto && (!lset.sheetUrl || !b)) return { skipped: !lset.sheetUrl ? 'nourl' : 'noblog', checked: 0, results: [] };   // 자동 실행인데 아직 설정 전이면 조용히 건너뜀
  if (!b) throw Error('내 블로그를 먼저 골라 주세요. (레몬 현장 탭 ① 내 블로그)');
  const ls = await sheetCtx(4), today = toSheetDay(kstDay(Date.now()));
  const pend = await lemon._sheet.postSheet(ls, { brand: 'lemon', action: 'pending', tab: b.tab, blogKey: b.key, blogId: b.id, today, maxDays: st.daysBack });
  const rows = pend.rows || [];
  const out = { brand: 'lemon', blog: b.key, tab: pend.tab || b.tab, today, checked: rows.length, results: [], rankOn: st.provider === 'tab' || !!(st.naverId && st.naverSecret), noRankCol: !!pend.noRankCol };
  if (!rows.length) return out;
  // 링크 칸이 비어 있는 줄은 블로그 RSS에서 제목으로 찾는다 (필요할 때만 한 번 읽음)
  const rssId = pend.blogId || b.id;
  let items = null, rssErr = '';
  const loadRss = async () => {
    if (items || rssErr) return items;
    try {
      const r = await fetch('https://rss.blog.naver.com/' + encodeURIComponent(rssId) + '.xml', { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'Mozilla/5.0 KitchenKoStudio' } });
      if (!r.ok) throw Error('응답 코드 ' + r.status);
      items = parseRss(await r.text());
    } catch (e) { rssErr = e.message; }
    return items;
  };
  for (const row of rows) {
    const res = { row: row.row, date: row.date, site: row.apt || row.site, link: '', rank: '', note: '' };
    try {
      const ref = blogRef(row.link);
      let id = '', logNo = '', link = '';
      if (ref) { id = ref.id; logNo = ref.logNo; link = row.link; }
      else {
        const its = await loadRss();
        if (!its) { res.note = '블로그 RSS를 읽지 못했어요(' + rssId + '): ' + rssErr; out.results.push(res); continue; }
        const m = matchPost({ date: row.date, site: row.apt || row.site, kw: row.kw }, its);
        if (!m.item) { res.note = m.why || '글을 정하지 못했어요'; out.results.push(res); continue; }
        id = rssId; logNo = m.item.logNo; link = 'https://blog.naver.com/' + id + '/' + logNo;
      }
      let rank = '', rankErr = '';
      if (out.rankOn && !out.rankFail) {
        try { rank = await ranksFor(st, { kw: row.kw }, logNo, null, id, 3); }
        catch (e) { rankErr = e.message; out.rankFail = e.message; }
      }
      res.link = link; res.rank = rank;
      const fillLink = row.link ? '' : link;      // 링크 칸에 이미 뭔가 적혀 있으면(카페 링크 등) 건드리지 않는다
      if (opts.dryRun) { res.note = '미리보기(시트에 쓰지 않음)' + (rankErr ? ' · 순위 조회 실패: ' + rankErr : ''); out.results.push(res); continue; }
      if (!rank && !fillLink) { res.note = rankErr ? '순위 조회 실패: ' + rankErr : (!out.rankOn ? '순위는 API 키가 없어 건너뜀' : '순위 조회 건너뜀'); out.results.push(res); continue; }
      const w = await lemon._sheet.postSheet(ls, { brand: 'lemon', action: 'fill', tab: b.tab, blogKey: b.key, blogId: b.id, row: row.row, expectDate: row.date, expectSite: row.site, expectApt: row.apt, link: fillLink, rank });
      res.note = [w.linked ? '링크 기록' : '', w.ranked ? '순위 기록' : '', rankErr ? '순위 조회 실패: ' + rankErr : ''].filter(Boolean).join(' · ');
    } catch (e) { res.note = e.message; }
    out.results.push(res);
  }
  return out;
}

async function handle(req, res, url) {
  const p = url.split('?')[0];
  try {
    if (p === '/api/rank/status') {
      const st = readSettings();
      return json(res, 200, { ok: true, configured: st.provider === 'tab' || !!(st.naverId && st.naverSecret), provider: st.provider, naverId: st.naverId, naverSecret: st.naverSecret ? MASK : '', blogId: st.blogId });
    }
    if (p === '/api/rank/settings' && req.method === 'POST') {
      const b = await readJson(req, 8192), cur = readRaw();
      if ('naverId' in b) cur.naverId = String(b.naverId || '').trim();
      if ('naverSecret' in b && String(b.naverSecret) !== MASK) cur.naverSecret = String(b.naverSecret || '').trim();
      if ('provider' in b && (b.provider === 'tab' || b.provider === 'hub' || b.provider === 'legacy')) cur.provider = b.provider;
      if ('blogId' in b && /^[A-Za-z0-9_.-]{2,40}$/.test(String(b.blogId || '').trim())) cur.blogId = String(b.blogId).trim();
      fs.mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 });
      fs.writeFileSync(SET_FILE, JSON.stringify(cur, null, 1), { mode: 0o600 });
      return json(res, 200, { ok: true });
    }
    if (p === '/api/rank/run' && req.method === 'POST') {
      const b = await readJson(req, 4096);
      return json(res, 200, { ok: true, ...(await run({ dryRun: !!b.dryRun })) });
    }
    if (p === '/api/rank/lemon' && req.method === 'POST') {       // 레몬하우스 (예전 서버에는 이 주소가 없어서, 새 화면+예전 서버면 '다시 켜 주세요' 안내가 떠요)
      const b = await readJson(req, 4096);
      return json(res, 200, { ok: true, ...(await runLemon({ dryRun: !!b.dryRun, auto: !!b.auto, blogKey: b.blogKey })) });
    }
    return json(res, 404, { ok: false, error: '알 수 없는 요청이에요.' });
  } catch (e) { return json(res, 200, { ok: false, error: e.message || String(e) }); }
}

module.exports = { handle, _test: { parseRss, matchPost, naverRank, tabRank, resultKeys, ranksFor, logNoOf, sheetDay, toSheetDay, splitKw, key_, blogRef, runLemon } };
