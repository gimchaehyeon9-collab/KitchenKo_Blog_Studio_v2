// 레몬하우스 모드 — 로컬 기능 (npm 설치 불필요)
// 1) 레몬하우스 OneDrive '0. 레몬하우스 배포용' 폴더에서 '인텍(번호)' 현장 폴더를 찾아 보여 줍니다
// 2) 고른 현장 폴더를 내 블로그 번호 폴더(★9. ktjkde0610 …)로 옮깁니다 (OneDrive 동기화 폴더 안에서의 이동)
// 3) 사진을 컴퓨터에 저장합니다 (화면에서 가로 반전 + 레몬하우스 각인을 한 사진을 받아서 씁니다)
// 4) 글 작성이 끝나면 '블로그 관리 구글 시트'의 내 블로그 탭(레몬하우스) 또는 '키친앤코' 탭(키친앤코)에 한 줄을 기록합니다 (구글 Apps Script 웹앱으로 전송)
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const videodir = require('./videodir.js');   // 영상용 사진 저장 폴더 (기준폴더\26.11\11.3\현장명)

const KEY_DIR = path.join(os.homedir(), '.kitchenko-studio');
const SET_FILE = path.join(KEY_DIR, 'lemon-settings.json');
const PENDING_FILE = path.join(KEY_DIR, 'lemon-sheet-pending.json');
const KITCHEN_TAB = '키친앤코';
const PROFILE_FILE = path.join(KEY_DIR, 'lemon-profiles.json');   // 블로그 번호별 문체·서식
const PRESET_FILE = path.join(__dirname, 'data', 'lemon-preset.json');   // 배포용 압축 파일에 넣어 두는 기본값 (선택)
const IMG = /\.(jpe?g|png|webp)$/i;
const DIST_NAME = /레몬하우스\s*배포용/;

// 블로그 관리 시트의 탭 이름 · 블로그 번호 · 네이버 아이디 (시트 '블로그 관리 알바 작업시트' 기준)
const BLOGS = [
  { key: '메인', tab: '메인(shim2h)', id: 'shim2h' },
  { key: '1', tab: '1번(040404)', id: 'lemon040404' },
  { key: '2', tab: '2번(0400)', id: 'lemon0400' },
  { key: '3', tab: '3번(0482)', id: 'lemon0482' },
  { key: '4', tab: '4번(kkokkointerior)', id: 'kkokkointerior' },
  { key: '5', tab: '5번(이너피스)', id: 'innerpeace1235' },
  { key: '6', tab: '6번(tooeh)', id: 'tooehdguslo' },
  { key: '7', tab: '7번(ehdguslo)', id: 'ehdguslo99' },
  { key: '8', tab: '8번(kdektj0206)', id: 'kdektj0206' },
  { key: '9', tab: '9번(ktjkde0610)', id: 'ktjkde0610' },
  { key: '10', tab: '10번(dddnco)', id: 'dddnco' },
  { key: '11', tab: '11번(love-072)', id: 'love-072' },
  { key: '13', tab: '13번(musix10)', id: 'musix10' },
  { key: '15', tab: '15번(dotsdoor)', id: 'dotsdoor' },
  { key: '16', tab: 'artroom0111', id: 'artroom0111' }
];

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
async function readJson(req, cap) {
  const chunks = []; let n = 0;
  for await (const ch of req) { n += ch.length; if (n > cap) throw Error('전송 용량이 너무 큽니다.'); chunks.push(ch); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
const exists = p => { try { return !!p && fs.existsSync(p); } catch (_) { return false; } };
const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch (_) { return false; } };
// OneDrive '내 파일에 바로가기 추가'로 만든 폴더는 바로가기(링크)로 보일 수 있어서 함께 폴더로 봐요
const entIsDir = (base, e) => e.isDirectory() || (e.isSymbolicLink() && isDir(path.join(base, e.name)));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const byName = (a, b) => a.localeCompare(b, 'ko', { numeric: true });

// ── 설정 ──
function readPreset() { try { return JSON.parse(fs.readFileSync(PRESET_FILE, 'utf8')); } catch (_) { return {}; } }
function readRaw() { try { return JSON.parse(fs.readFileSync(SET_FILE, 'utf8')); } catch (_) { return {}; } }
function writeRaw(o) { fs.mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 }); fs.writeFileSync(SET_FILE, JSON.stringify(o, null, 1), { mode: 0o600 }); }

function oneDriveRoots() {
  const home = os.homedir(), set = new Set();
  for (const k of ['OneDrive', 'OneDriveCommercial', 'OneDriveConsumer']) if (process.env[k]) set.add(process.env[k]);
  try { for (const e of fs.readdirSync(home, { withFileTypes: true })) if (e.isDirectory() && /^OneDrive/i.test(e.name)) set.add(path.join(home, e.name)); } catch (_) {}
  return [...set].filter(isDir);
}
// 폴더 이름이 조건에 맞는 첫 폴더 (깊이 제한 · 너비 우선)
function findDir(root, test, maxDepth) {
  let level = [root];
  for (let d = 0; d <= maxDepth; d++) {
    const next = [];
    for (const dir of level) {
      let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { continue; }
      for (const e of ents) {
        if (!entIsDir(dir, e) || e.name.startsWith('.')) continue;
        if (test(e.name)) return path.join(dir, e.name);
        next.push(path.join(dir, e.name));
      }
    }
    level = next;
  }
  return '';
}
const starInfo = name => { const m = /^★\s*(\d+|메인)\s*[.\s]\s*(.*)$/.exec(String(name || '').trim()); return m ? { key: m[1], id: (m[2] || '').trim() } : null; };
function starDirsIn(dir) {
  let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return []; }
  return ents.filter(e => entIsDir(dir, e) && starInfo(e.name)).map(e => e.name);
}
// ★번호 폴더들이 들어 있는 폴더: 배포용 폴더 안 · 그 옆 · 그 위쪽에서 가장 많이 모여 있는 곳
function blogRootCands(dist) {
  const up = path.dirname(dist), up2 = path.dirname(up);
  const cands = [dist, up, up2];
  for (const base of [dist, up]) { try { for (const e of fs.readdirSync(base, { withFileTypes: true })) if (entIsDir(base, e) && !e.name.startsWith('.') && !starInfo(e.name)) cands.push(path.join(base, e.name)); } catch (_) {} }
  return cands;
}
function findBlogRoot(dist) {
  if (!dist) return '';
  let best = '', bn = 0;
  for (const c of blogRootCands(dist)) { const n = starDirsIn(c).length; if (n > bn) { bn = n; best = c; } }
  return best;
}
function readSettings() {
  const pre = readPreset(), raw = readRaw();
  const s = {
    distRoot: '', blogRoot: '', myBlog: '', intek: [],
    saveDir: videodir.DEFAULT_ROOT,   // 기준 폴더 (그 안에 월 → 날짜 → 현장명 폴더를 만들어요)
    sheetUrl: pre.sheetUrl || '', sheetKey: pre.sheetKey || '', ...raw
  };
  if (!s.sheetUrl && pre.sheetUrl) s.sheetUrl = pre.sheetUrl;
  if (!s.sheetKey && pre.sheetKey) s.sheetKey = pre.sheetKey;
  if (!Array.isArray(s.intek)) s.intek = [];
  s.saveDir = videodir.migrate(s.saveDir);   // 예전 기본값(다운로드 폴더)이면 새 기본 폴더로
  s.autoDist = false; s.autoBlog = false;
  if (!s.distRoot || !isDir(s.distRoot)) {
    s.distRoot = ''; for (const r of oneDriveRoots()) { const hit = findDir(r, n => DIST_NAME.test(n), 3); if (hit) { s.distRoot = hit; s.autoDist = true; break; } }
  }
  // ★9 폴더 자체를 적어도, ★ 폴더가 하나도 없는 곳을 적어도 → ★ 폴더들이 들어 있는 바깥 폴더로 바로잡아요
  if (s.blogRoot && isDir(s.blogRoot) && starInfo(path.basename(s.blogRoot.replace(/[\\/]+$/, '')))) s.blogRoot = path.dirname(s.blogRoot.replace(/[\\/]+$/, ''));
  if (!s.blogRoot || !isDir(s.blogRoot) || !starDirsIn(s.blogRoot).length) {
    const auto = findBlogRoot(s.distRoot);
    if (auto || !s.blogRoot || !isDir(s.blogRoot)) { s.blogRoot = auto; s.autoBlog = !!auto; }
  }
  return s;
}
const blogOf = key => BLOGS.find(b => b.key === String(key));
function myBlogDir(st) {
  const b = blogOf(st.myBlog); if (!b) return '';
  const pick = root => {
    const names = starDirsIn(root);
    const hit = names.find(n => starInfo(n).key === b.key) || names.find(n => starInfo(n).id && b.id && starInfo(n).id.toLowerCase().includes(b.id.toLowerCase().slice(0, 8)));
    return hit ? path.join(root, hit) : '';
  };
  // 정해 둔 위치에 없으면 ★ 폴더가 있을 만한 다른 곳(배포용 폴더 안·옆)도 찾아봐요 — ★ 폴더가 여러 곳에 나뉘어 있어도 되도록
  const roots = [st.blogRoot, ...(st.distRoot ? blogRootCands(st.distRoot) : [])].filter(Boolean);
  for (const r of roots) { const h = pick(r); if (h) return h; }
  return '';
}
// ── 현장 폴더 이름 읽기: "26.06.09. 경상남도 양산시 북정동 (884-2) 새롬성원네오피아트 104-1302 _32평(정동원) 인텍 2" ──
function parseSite(name) {
  // 맨 앞의 '(X)' · '(x 복층)' 같은 표시 — 담당자가 쓴 표시(X는 사용 불가/이미 사용으로 보고 추천에서 빼요)
  const pre = /^\s*\(([^)]*)\)\s*/.exec(String(name)), flag = pre && !/^\d/.test(pre[1].trim()) ? pre[1].trim() : '';
  const core = flag ? String(name).slice(pre[0].length) : String(name);
  const ms = [...core.matchAll(/인[텍택]\s*\(?\s*(\d{1,2})?(?!\d)/g)], last = ms.length ? ms[ms.length - 1] : null;
  const dm = /^\s*(\d{2})\.\s*(\d{1,2})\.\s*(\d{1,2})/.exec(core);
  // 평수: 53평 · 33C평 · 34 C평 · 32A2평 · 39.9평 · 35평B
  const pm = /(\d{2,3}(?:\.\d)?)\s*([A-Za-z]{0,2}\d?)\s*평(?:\s*([A-Za-z])(?![A-Za-z0-9가-힣]))?/.exec(core);
  // '_35 인텍 10'처럼 '평' 글자 없이 밑줄 뒤에 숫자만 있는 이름도 평수로 추정
  const pg = pm ? null : /_\s*(\d{2})(?!\d)/.exec(core);
  const person = [...core.matchAll(/\(([^()]+)\)/g)].map(m => m[1]).filter(x => !/^\d[\d-]*$/.test(x)).pop() || '';
  const ptype = pm ? ((pm[2] || pm[3] || '').toUpperCase().replace(/^P$/, '')) : '';
  return {
    intek: last ? (last[1] || '') : null,
    date: dm ? dm[1] + '.' + dm[2].padStart(2, '0') + '.' + dm[3].padStart(2, '0') : '',
    pyeong: pm ? pm[1] + '평' : (pg ? pg[1] + '평?' : ''), pyN: pm ? +pm[1] : (pg ? +pg[1] : 0), ptype,
    flag, used: /^x/i.test(flag), person
  };
}
// 현장 폴더 안의 사진 위치: '보정본' 폴더 → 바로 아래 → 한 단계 아래 가장 많은 폴더
function photoDirOf(dir) {
  let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return { dir, files: [] }; }
  const imgs = d => { try { return fs.readdirSync(d).filter(n => IMG.test(n)).sort(byName); } catch (_) { return []; } };
  for (const e of ents) if (entIsDir(dir, e) && /보정본/.test(e.name)) { const f = imgs(path.join(dir, e.name)); if (f.length) return { dir: path.join(dir, e.name), files: f }; }
  const own = ents.filter(e => e.isFile() && IMG.test(e.name)).map(e => e.name).sort(byName);
  if (own.length) return { dir, files: own };
  let best = { dir, files: [] };
  for (const e of ents) if (entIsDir(dir, e) && !e.name.startsWith('.')) { const f = imgs(path.join(dir, e.name)); if (f.length > best.files.length) best = { dir: path.join(dir, e.name), files: f }; }
  return best;
}
const safeName = n => {
  const s = String(n || '');
  if (!s || /[\\/]/.test(s) || s === '.' || s === '..' || s.includes('\0')) throw Error('폴더 이름이 올바르지 않아요.');
  return s;
};
function listSites(root, tokens, withCount) {
  if (!root || !isDir(root)) return [];
  let ents = []; try { ents = fs.readdirSync(root, { withFileTypes: true }); } catch (_) { return []; }
  const want = new Set(tokens || []);
  const out = [];
  for (const e of ents) {
    if (!entIsDir(root, e) || e.name.startsWith('.') || starInfo(e.name)) continue;
    const info = parseSite(e.name);
    if (want.size) { const t = info.intek === null ? '' : (info.intek === '' ? 'none' : info.intek); if (info.intek === null || !want.has(t)) continue; }
    const row = { name: e.name, ...info, n: null };
    if (withCount) row.n = photoDirOf(path.join(root, e.name)).files.length;
    out.push(row);
  }
  out.sort((a, b) => (b.date || '').localeCompare(a.date || '') || byName(a.name, b.name));
  return out;
}

// ── 폴더 옮기기 (같은 OneDrive 안이면 이름 바꾸기, 드라이브가 다르면 복사 후 확인하고 원본 삭제) ──
function countFiles(dir) { let n = 0; for (const e of fs.readdirSync(dir, { withFileTypes: true })) n += e.isDirectory() ? countFiles(path.join(dir, e.name)) : 1; return n; }
async function moveDir(src, dest) {
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try { fs.renameSync(src, dest); return; }
    catch (e) {
      lastErr = e;
      if (e.code === 'EXDEV') {
        fs.cpSync(src, dest, { recursive: true, errorOnExist: true, force: false });
        if (countFiles(src) !== countFiles(dest)) throw Error('복사한 파일 수가 달라서 원본을 지우지 않았어요. 옮긴 폴더를 확인해 주세요.');
        fs.rmSync(src, { recursive: true, force: true });
        return;
      }
      if (['EBUSY', 'EPERM', 'EACCES'].includes(e.code)) { await sleep(900); continue; }
      throw e;
    }
  }
  if (['EBUSY', 'EPERM', 'EACCES'].includes(lastErr.code)) throw Error('폴더가 사용 중이에요. OneDrive가 동기화하는 중이거나 탐색기에서 열려 있을 수 있어요. 잠시 뒤 다시 눌러 주세요.');
  throw lastErr;
}

// ── 구글 시트 기록 (Apps Script 웹앱) ──
function readPending() { try { const a = JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8')); return Array.isArray(a) ? a : []; } catch (_) { return []; } }
function writePending(a) { fs.mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 }); fs.writeFileSync(PENDING_FILE, JSON.stringify(a, null, 1), { mode: 0o600 }); }
// 시트 자체의 주소(docs.google.com/spreadsheets/…)를 넣는 실수를 알려 줘요 — 필요한 건 Apps Script '웹 앱' 주소
function sheetUrlProblem(u) {
  u = String(u || '').trim();
  if (!u) return '';
  if (/docs\.google\.com|drive\.google\.com/i.test(u)) return '넣어 둔 주소는 구글 시트 자체의 주소예요. 필요한 건 Apps Script를 [배포 → 웹 앱]으로 배포하면 나오는 주소(https://script.google.com/macros/s/…/exec)예요. 사용방법의 ‘시트 연결’을 참고해 주세요.';
  if (!/^https?:\/\//i.test(u)) return '웹 앱 주소는 https://script.google.com/macros/s/…/exec 모양이에요.';
  return '';
}
async function sendSheet(st, rec) {
  if (!st.sheetUrl) throw Error('구글 시트 연결 주소가 아직 없어요. [연결 설정]에 웹앱 주소를 넣어 주세요.');
  { const bad = sheetUrlProblem(st.sheetUrl); if (bad) throw Error(bad); }
  const b = blogOf(rec.blogKey || st.myBlog);
  if (!b) throw Error('내 블로그 번호를 먼저 골라 주세요.');
  return postSheet(st, { brand: 'lemon', tab: b.tab, blogKey: b.key, blogId: b.id, date: rec.date, site: rec.site, apt: rec.apt, region: rec.region, keywords: rec.keywords, link: rec.link || '' });
}
async function postSheet(st, body) {
  let r;
  try {
    r = await fetch(st.sheetUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ key: st.sheetKey || '', ...body }), redirect: 'follow', signal: AbortSignal.timeout(40000) });
  } catch (e) { throw Error('시트에 연결하지 못했어요: ' + (e.cause && e.cause.code || e.message)); }
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch (_) { throw Error('시트 응답을 읽지 못했어요. 웹앱 주소와 배포 설정(액세스: 모든 사용자)을 확인해 주세요.'); }
  if (!j.ok) throw Error(j.error || '시트 기록 실패');
  return j;
}
// 키친앤코 탭 기록은 새 스크립트(v2)가 있어야 해요. 예전 스크립트는 레몬 탭 형식으로 잘못 적을 수 있어서, 보내기 전에 한 번 확인하고 10분 동안 기억해요.
const caps = { url: '', at: 0 };
async function ensureKitchenScript(st) {
  if (caps.url === st.sheetUrl && Date.now() - caps.at < 10 * 60e3) return;
  let r;
  try { r = await fetch(st.sheetUrl, { redirect: 'follow', signal: AbortSignal.timeout(20000) }); } catch (e) { throw Error('시트에 연결하지 못했어요: ' + (e.cause && e.cause.code || e.message)); }
  let j; try { j = JSON.parse(await r.text()); } catch (_) { throw Error('시트 응답을 읽지 못했어요. 웹앱 주소와 배포 설정(액세스: 모든 사용자)을 확인해 주세요.'); }
  if (!(j && j.ok && j.v >= 2)) throw Error('시트에 설치된 스크립트가 예전 버전이에요(레몬하우스 전용). 새 ‘블로그시트연결.gs’ 내용으로 바꿔 붙여넣고 [배포 → 배포 관리 → 새 버전]으로 다시 배포해 주세요.');
  caps.url = st.sheetUrl; caps.at = Date.now();
}
async function sendKitchen(st, rec) {
  if (!st.sheetUrl) throw Error('구글 시트 연결 주소가 아직 없어요. [시트 연결 설정]에 웹앱 주소를 넣어 주세요.');
  { const bad = sheetUrlProblem(st.sheetUrl); if (bad) throw Error(bad); }
  await ensureKitchenScript(st);
  return postSheet(st, { brand: 'kitchenko', tab: KITCHEN_TAB, date: rec.date, site: rec.site, item: rec.item, keywords: rec.keywords, link: rec.link || '' });
}
const sendAny = (st, rec) => rec.brand === 'kitchenko' ? sendKitchen(st, rec) : sendSheet(st, rec);

// 링크는 http(s) 주소만 받아요 (시트에 이상한 글자가 들어가지 않게)
const cleanLink = v => { v = String(v || '').trim(); return /^https?:\/\/\S+$/i.test(v) && v.length < 500 ? v : ''; };
// 못 보낸 기록은 대기열에 보관 — 같은 내용(브랜드·날짜·현장·품목/추천글)은 한 번만 보관
function queue(rec, e) {
  const a = readPending(), k = r => [r.brand || 'lemon', r.date, r.site, r.item || r.apt].join('|');
  const i = a.findIndex(x => k(x) === k(rec));
  const row = { ...rec, at: new Date().toISOString(), error: e.message };
  if (i >= 0) a[i] = row; else a.push(row);
  writePending(a.slice(-50));
}

// ── 블로그별 문체·서식 프로필 (블로그 번호 → 내용) ──
function readProfiles() { try { const o = JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf8')); return o && typeof o === 'object' ? o : {}; } catch (_) { return {}; } }
function writeProfiles(o) {
  fs.mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 });
  const tmp = PROFILE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(o), { mode: 0o600 }); fs.renameSync(tmp, PROFILE_FILE);   // 쓰다 끊겨도 기존 파일이 남도록
}
const profileKey = k => { k = String(k || '').trim(); return k === 'default' || blogOf(k) ? k : ''; };
// 화면에서 받은 프로필에서 필요한 칸만, 길이를 제한해서 저장
const clip = (v, n) => String(v == null ? '' : v).slice(0, n);
function cleanProfile(b) {
  const o = {};
  const S = { titlePattern: 200, subtitles: 2000, greeting: 1500, spaces: 600, extraTags: 400, videoSuffix: 80, headingMode: 12, headingWrap: 60, emphMode: 12, closing: 1500, phone: 60, phoneColor: 12, lines: 20, samples: 30000, tone: 600 };
  for (const k of Object.keys(S)) if (k in b) o[k] = clip(b[k], S[k]);
  if (b.template && typeof b.template === 'object') {
    const t = JSON.stringify(b.template);
    if (t.length > 400000) throw Error('가져온 서식이 너무 커요. 사진·동영상이 많은 글이 아니라 문단 위주의 글에서 다시 가져와 주세요.');
    o.template = JSON.parse(t);
  } else o.template = null;
  if (b.tplInfo && typeof b.tplInfo === 'object') o.tplInfo = JSON.parse(JSON.stringify(b.tplInfo).slice(0, 4000));
  o.updated = Date.now();
  return o;
}

async function handle(req, res, url) {
  const u = new URL(url, 'http://127.0.0.1'), p = u.pathname;
  try {
    if (p === '/api/lemon/profile') {
      if (req.method === 'POST') {
        const b = await readJson(req, 1024 * 1024), key = profileKey(b.blog);
        if (!key) throw Error('블로그 번호가 올바르지 않아요.');
        const all = readProfiles(); all[key] = cleanProfile(b.profile || {}); writeProfiles(all);
        return json(res, 200, { ok: true, updated: all[key].updated });
      }
      const key = profileKey(u.searchParams.get('blog'));
      if (!key) throw Error('블로그 번호가 올바르지 않아요.');
      return json(res, 200, { ok: true, profile: readProfiles()[key] || null, preset: readPreset().profileDefaults || null });
    }
    const st = readSettings();
    if (p === '/api/lemon/status') {
      const pre = readPreset(), my = myBlogDir(st);
      const pub = { ...st, sheetKey: '', hasSheetKey: !!st.sheetKey };
      return json(res, 200, {
        ok: true, settings: pub, blogs: BLOGS, distOk: isDir(st.distRoot), blogOk: isDir(st.blogRoot),
        myFolder: my ? path.basename(my) : '', myFolderOk: !!my, preset: { brand: pre.brand || '', lock: !!pre.lock },
        pending: readPending().length,
        profiles: Object.fromEntries(Object.entries(readProfiles()).map(([k, v]) => [k, { tpl: !!(v && v.template), at: v && v.updated || 0 }]))
      });
    }
    if (p === '/api/lemon/settings' && req.method === 'POST') {
      const b = await readJson(req, 16384), cur = readRaw();
      for (const k of ['distRoot', 'blogRoot', 'saveDir', 'sheetUrl']) if (k in b) cur[k] = String(b[k] || '').trim().replace(/^"|"$/g, '');
      if ('sheetKey' in b && String(b.sheetKey || '').trim()) cur.sheetKey = String(b.sheetKey).trim();
      if ('myBlog' in b) cur.myBlog = blogOf(b.myBlog) ? String(b.myBlog) : '';
      if ('intek' in b) cur.intek = (Array.isArray(b.intek) ? b.intek : []).map(String).filter(x => /^(none|\d{1,2})$/.test(x));
      writeRaw(cur);
      return json(res, 200, { ok: true, warn: 'sheetUrl' in b ? sheetUrlProblem(cur.sheetUrl) : '' });
    }
    if (p === '/api/lemon/sites') {
      if (!isDir(st.distRoot)) throw Error('레몬하우스 배포용 폴더를 찾지 못했어요. [연결 설정]에서 폴더 위치를 알려 주세요.');
      const tokens = (u.searchParams.get('intek') || '').split(',').map(s => s.trim()).filter(Boolean);
      const mine = myBlogDir(st);
      // 배포용 폴더에 지금 어떤 인텍 번호가 몇 곳 있는지(이름만 읽어요) — 고른 번호가 없을 때 안내용
      const avail = {}; let latest = '';
      for (const r of listSites(st.distRoot, [], false)) { const t = r.intek === null ? '' : (r.intek === '' ? 'none' : r.intek); if (t) avail[t] = (avail[t] || 0) + 1; if (r.date && r.date > latest) latest = r.date; }
      return json(res, 200, { ok: true, sites: listSites(st.distRoot, tokens, true), mine: mine ? listSites(mine, [], true) : [], myFolder: mine ? path.basename(mine) : '', avail, latest });
    }
    if (p === '/api/lemon/photos') {
      const base = u.searchParams.get('base') === 'mine' ? myBlogDir(st) : st.distRoot;
      if (!base) throw Error('폴더를 찾지 못했어요.');
      const dir = path.join(base, safeName(u.searchParams.get('folder')));
      if (!isDir(dir)) throw Error('현장 폴더를 찾지 못했어요.');
      const pd = photoDirOf(dir);
      return json(res, 200, { ok: true, files: pd.files, sub: path.relative(dir, pd.dir) });
    }
    if (p === '/api/lemon/file') {
      const base = u.searchParams.get('base') === 'mine' ? myBlogDir(st) : st.distRoot;
      const dir = base && path.join(base, safeName(u.searchParams.get('folder')));
      const name = safeName(u.searchParams.get('name'));
      const pd = dir && isDir(dir) ? photoDirOf(dir) : null;
      const file = pd && path.join(pd.dir, name);
      if (!file || !IMG.test(name) || !exists(file)) { res.writeHead(404); return res.end(); }
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, { 'Content-Type': ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      return fs.createReadStream(file).pipe(res);
    }
    if (p === '/api/lemon/claim' && req.method === 'POST') {
      const b = await readJson(req, 4096), name = safeName(b.folder);
      if (!isDir(st.distRoot)) throw Error('레몬하우스 배포용 폴더를 찾지 못했어요.');
      if (!blogOf(st.myBlog)) throw Error('내 블로그 번호를 먼저 골라 주세요.');
      const mine = myBlogDir(st);
      if (!mine) throw Error('내 블로그 번호 폴더(★' + st.myBlog + '. …)를 찾지 못했어요. [연결 설정]에서 ★ 폴더들이 있는 위치를 알려 주세요.');
      const src = path.join(st.distRoot, name), dest = path.join(mine, name);
      if (exists(dest)) return json(res, 200, { ok: true, moved: false, already: true, myFolder: path.basename(mine) });
      if (!isDir(src)) throw Error('배포용 폴더에서 현장 폴더를 찾지 못했어요. 다른 사람이 먼저 가져갔을 수 있어요.');
      await moveDir(src, dest);
      return json(res, 200, { ok: true, moved: true, myFolder: path.basename(mine) });
    }
    if (p === '/api/lemon/saveimg' && req.method === 'POST') {
      const dirName = safeName(u.searchParams.get('dir')).slice(0, 120), name = safeName(u.searchParams.get('name'));
      if (!/\.jpe?g$/i.test(name)) throw Error('저장 형식이 올바르지 않아요.');
      const dest = videodir.videoFolder(st.saveDir, dirName).dir;   // 기준폴더\26.11\11.3\현장 폴더명
      const chunks = []; let n = 0;
      for await (const ch of req) { n += ch.length; if (n > 40 * 1024 * 1024) throw Error('사진이 너무 커요.'); chunks.push(ch); }
      const buf = Buffer.concat(chunks); if (buf.length < 100) throw Error('사진 데이터가 비어 있어요.');
      fs.writeFileSync(path.join(dest, name), buf);
      return json(res, 200, { ok: true, dir: dest });
    }
    if (p === '/api/lemon/sheet' && req.method === 'POST') {
      const b = await readJson(req, 16384);
      const rec = { brand: 'lemon', date: String(b.date || '').trim(), site: String(b.site || '').trim(), apt: String(b.apt || '').trim(), region: String(b.region || '').trim(), keywords: String(b.keywords || '').trim(), link: cleanLink(b.link), blogKey: st.myBlog };
      if (!/^\d{2}\.\d{2}\.\d{2}$/.test(rec.date)) throw Error('포스팅 날짜는 26.10.27 형태로 적어 주세요.');
      if (!rec.site) throw Error('현장명(인텍)이 비어 있어요.');
      if (!rec.apt) throw Error('추천글 현장이 비어 있어요.');
      if (b.auto && !st.sheetUrl) return json(res, 200, { ok: true, skipped: 'nourl' });     // 자동 기록인데 시트 연결을 아직 안 했으면 조용히 건너뜀
      try { const j = await sendSheet(st, rec); return json(res, 200, { ok: true, ...j }); }
      catch (e) { queue(rec, e); throw e; }
    }
    if (p === '/api/lemon/ksheet' && req.method === 'POST') {
      const b = await readJson(req, 16384);
      const rec = { brand: 'kitchenko', date: String(b.date || '').trim(), site: String(b.site || '').trim(), item: String(b.item || '').trim(), keywords: String(b.keywords || '').trim(), link: cleanLink(b.link) };
      if (!/^\d{2}\.\d{2}\.\d{2}$/.test(rec.date)) throw Error('포스팅 날짜는 26.10.27 형태로 적어 주세요.');
      if (!rec.site) throw Error('현장명이 비어 있어요.');
      if (!rec.item) throw Error('품목이 비어 있어요.');
      if (b.auto && !st.sheetUrl) return json(res, 200, { ok: true, skipped: 'nourl' });
      try { const j = await sendKitchen(st, rec); return json(res, 200, { ok: true, ...j }); }
      catch (e) { queue(rec, e); throw e; }
    }
    if (p === '/api/lemon/ping') {
      if (!st.sheetUrl) throw Error('시트 연결 주소를 먼저 넣고 저장해 주세요.');
      { const bad = sheetUrlProblem(st.sheetUrl); if (bad) throw Error(bad); }
      let r; try { r = await fetch(st.sheetUrl, { redirect: 'follow', signal: AbortSignal.timeout(20000) }); } catch (e) { throw Error('연결하지 못했어요: ' + (e.cause && e.cause.code || e.message)); }
      let j; try { j = JSON.parse(await r.text()); } catch (_) { throw Error('응답을 읽지 못했어요. 웹 앱 주소가 맞는지, 배포의 액세스 권한이 ‘모든 사용자’인지 확인해 주세요.'); }
      if (!j.ok) throw Error(j.error || '연결 확인 실패');
      return json(res, 200, { ok: true, ping: j.ping || '연결됐어요', kitchen: j.v >= 2 });
    }
    if (p === '/api/lemon/retry' && req.method === 'POST') {
      const list = readPending(), left = []; let done = 0;
      for (const rec of list) { try { await sendAny(st, rec); done++; } catch (_) { left.push(rec); } }
      writePending(left);
      return json(res, 200, { ok: true, done, left: left.length });
    }
    res.writeHead(404); res.end();
  } catch (e) { json(res, 400, { ok: false, error: e.message || '요청 실패' }); }
}

module.exports = { handle, BLOGS, _sheet: { readSettings, postSheet, sheetUrlProblem }, _test: { parseSite, listSites, photoDirOf, starInfo, findBlogRoot, moveDir, blogOf } };
