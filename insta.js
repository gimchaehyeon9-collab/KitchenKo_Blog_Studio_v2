// 키친앤코 스튜디오 — 인스타 · 현장 탭용 로컬 기능 (npm 설치 불필요)
// 1) 개인 엑셀 시트(26년 키코.xlsx)를 '읽기만' 해서 현장 목록을 만듭니다 (시트는 절대 수정하지 않음)
// 2) 원드라이브 시공사례 폴더의 사진을 화면에 보여 줍니다 (원본은 건드리지 않음)
// 3) 확정한 인스타 글(4:5 기본, 1:1~1.91:1도 선택 가능한 사진 + 글)을 구글 드라이브 '키친앤코 인스타 업로드' 폴더에 넣어 예약합니다
//    → 평일 아침 Claude 예약 작업이 이 폴더를 보고 인스타에 올립니다
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const https = require('node:https');
const videodir = require('./videodir.js');   // 영상용 사진 저장 폴더 (기준폴더\26.11\11.3\현장명)

const KEY_DIR = path.join(os.homedir(), '.kitchenko-studio');
const SET_FILE = path.join(KEY_DIR, 'insta-settings.json');
const MEM_FILE = path.join(KEY_DIR, 'insta-memory.json');
const SEED_MEM = path.join(__dirname, 'data', 'insta-memory.json');
const QUEUE_NAME = '키친앤코 인스타 업로드';
const IMG = /\.(jpe?g|png|webp)$/i;

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

// ── 설정 ──
function detectQueueDir() {
  const home = os.homedir(), c = [];
  for (const d of 'GHIJKLMNOPQRSTUVWXYZDEF') for (const my of ['내 드라이브', 'My Drive']) c.push(d + ':\\' + my + '\\' + QUEUE_NAME);
  for (const base of ['내 드라이브', 'My Drive', 'Google Drive', path.join('Google Drive', '내 드라이브'), path.join('Google Drive', 'My Drive')]) c.push(path.join(home, base, QUEUE_NAME));
  return c.find(isDir) || '';
}
function defaults() {
  return {
    sheetPath: process.platform === 'win32' ? 'D:\\김채현 키친앤코\\26년 키코.xlsx' : '',
    photoRoot: path.join(os.homedir(), 'OneDrive', '키친앤코', '0. 시공사례', '10. 2026년도 시공사례'),
    queueDir: '',
    fireId: '',       // 바로 발행 즉시 실행: Claude 예약 작업(루틴) ID (trig_…)
    fireToken: '',    // 그 루틴의 API 토큰 (사장님 PC에만 저장)
    exportDir: videodir.DEFAULT_ROOT   // 영상용 사진 기준 폴더 (그 안에 월 → 날짜 → 현장명 폴더를 만들어요)
  };
}
function readSettings() {
  let s = {}; try { s = JSON.parse(fs.readFileSync(SET_FILE, 'utf8')); } catch (_) {}
  const d = defaults(), out = { ...d, ...s };
  for (const k of Object.keys(d)) if (!out[k]) out[k] = d[k];
  if (!out.queueDir || !isDir(out.queueDir)) out.queueDir = detectQueueDir() || out.queueDir || '';
  out.exportDir = videodir.migrate(out.exportDir);   // 예전 기본값(다운로드 폴더)이면 새 기본 폴더로
  return out;
}

// ── 바로 발행 즉시 실행: [지금 바로 발행]을 누르면 Claude 예약 작업(루틴)을 공식 API로 바로 깨워요 ──
// 예약 작업은 최소 1시간 간격이라, 설정해 두면 기다리지 않고 바로 발행 작업이 시작돼요. 설정이 없으면 예전처럼 매시 5분에 확인해서 올려요.
const MASK = '●●●●●●●●';
const FIRE_DELAY_MS = 40 * 1000;   // 사진 파일이 구글 드라이브에 올라갈 시간을 조금 줘요 (작업 쪽에서도 최대 10분 기다려요)
let LAST_FIRE = null;
const fireReady = st => !!(st.fireId && st.fireToken);
function fireCall(st, text) {
  return new Promise(resolve => {
    const body = JSON.stringify({ text });
    const req = https.request({
      hostname: 'api.anthropic.com', path: '/v1/claude_code/routines/' + encodeURIComponent(st.fireId) + '/fire', method: 'POST', timeout: 20000,
      headers: { Authorization: 'Bearer ' + st.fireToken, 'anthropic-version': '2026-10-21', 'anthropic-beta': 'experimental-cc-routine-2026-04-01', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let d = ''; res.on('data', c => { d += c; if (d.length > 20000) d = d.slice(0, 20000); });
      res.on('end', () => {
        let j = {}; try { j = JSON.parse(d); } catch (_) {}
        const ok = res.statusCode === 200;
        const why = ok ? '' : res.statusCode === 401 ? '토큰이 맞지 않아요 (루틴에서 토큰을 다시 만들면 예전 토큰은 못 써요)' : res.statusCode === 404 ? '루틴 ID를 찾지 못했어요' : res.statusCode === 429 ? '잠시 뒤 다시 시도해 주세요 (호출 한도)' : res.statusCode === 400 ? '루틴이 일시중지 상태일 수 있어요' : (j.error && j.error.message) || ('응답 코드 ' + res.statusCode);
        resolve({ ok, status: res.statusCode, why, session: j.claude_code_session_url || '' });
      });
    });
    req.on('timeout', () => req.destroy(Error('시간 초과')));
    req.on('error', e => resolve({ ok: false, status: 0, why: '연결 실패: ' + e.message, session: '' }));
    req.end(body);
  });
}
// 글 id의 바로 발행 요청을 보낸 뒤 결과를 LAST_FIRE에 남겨요 (화면 설정 칸에서 확인)
function fireNow(st, id) {
  if (!fireReady(st)) return false;
  const text = '스튜디오가 [지금 바로 발행]을 눌러 바로 깨웠어요 (요청 글 id: ' + id + '). 사진이 아직 구글 드라이브에 다 안 올라왔으면 30초 간격으로 최대 10분까지 기다리며 다시 확인해.';
  LAST_FIRE = { id, at: Date.now(), state: '곧 보내요' };
  setTimeout(async () => { const r = await fireCall(st, text); LAST_FIRE = { id, at: Date.now(), state: r.ok ? '보냈어요' : '실패', ok: r.ok, why: r.why, session: r.session }; }, FIRE_DELAY_MS);
  return true;
}

// ── 캡션 문체 예시 ──
let STYLE = null;
function styleCorpus() {
  if (!STYLE) { try { STYLE = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'style-corpus.json'), 'utf8')); } catch (_) { STYLE = { examples: [], short: [], phrases: [] }; } }
  return STYLE;
}
// 품목이 같은 예시 > 컬러가 같은 예시 > 나중에(다듬어진) 확정한 예시 순으로 고르고, 매번 조금씩 다르게 섞어요
function pickStyle(list, items, tones, n) {
  return (list || []).map(r => {
    let sc = 0;
    for (const c of items) if ((r.it || []).includes(c)) sc += 3;
    if (items.length && (r.it || []).length && !r.it.some(c => items.includes(c))) sc -= 2;
    for (const t of tones) if ((r.tn || []).includes(t)) sc += 2;
    return [sc + (r.i >= 380 ? 1 : 0) + Math.random() * 1.2, r];
  }).sort((a, b) => b[0] - a[0]).slice(0, n).map(x => x[1].t);
}

// ── xlsx 읽기 (zip + xml, 외부 라이브러리 없이) ──
function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw Error('엑셀 파일 형식이 아니에요.');
  const count = buf.readUInt16LE(eocd + 10); let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString('utf8');
    files.set(name.replace(/^\//, ''), { method, csize, off });
    p += 46 + nlen + xlen + clen;
  }
  return name => {
    const f = files.get(name); if (!f) return null;
    const ln = buf.readUInt16LE(f.off + 26), lx = buf.readUInt16LE(f.off + 28), st = f.off + 30 + ln + lx;
    const raw = buf.slice(st, st + f.csize);
    return (f.method === 8 ? zlib.inflateRawSync(raw) : raw).toString('utf8');
  };
}
const unxml = s => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&');
const attr = (tag, a) => { const m = new RegExp('\\s' + a + '="([^"]*)"').exec(tag); return m ? unxml(m[1]) : ''; };
const texts = x => [...String(x).matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => unxml(m[1])).join('');
function readWorkbook(file) {
  const get = unzip(fs.readFileSync(file));
  const wb = get('xl/workbook.xml'), rels = get('xl/_rels/workbook.xml.rels') || '';
  if (!wb) throw Error('엑셀 파일을 읽지 못했어요.');
  const relMap = {};
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    let t = attr(m[0], 'Target'); t = t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\//, '');
    relMap[attr(m[0], 'Id')] = t;
  }
  const shared = []; const ss = get('xl/sharedStrings.xml');
  if (ss) for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(texts(m[1]));
  // 칸 채우기 색: cellXfs → fills
  const styles = get('xl/styles.xml') || '', fills = [], xfs = [];
  const fillsXml = (/<fills\b[^>]*>([\s\S]*?)<\/fills>/.exec(styles) || [])[1] || '';
  for (const m of fillsXml.matchAll(/<fill>([\s\S]*?)<\/fill>|<fill\/>/g)) {
    const fg = /<fgColor\b[^>]*>/.exec(m[1] || '');
    fills.push(fg ? (attr(fg[0], 'rgb') || (attr(fg[0], 'theme') ? 'theme' + attr(fg[0], 'theme') + ':' + (attr(fg[0], 'tint') || '0') : '')) : '');
  }
  const xfXml = (/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles) || [])[1] || '';
  for (const m of xfXml.matchAll(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)) xfs.push(fills[+attr(m[0].split('>')[0], 'fillId') || 0] || '');
  const sheets = {};
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const name = attr(m[0], 'name'), rid = attr(m[0], 'r:id') || (/\bid="([^"]+)"/.exec(m[0]) || [])[1];
    const xml = get(relMap[rid] || ''); if (!xml) continue;
    const rows = {};
    for (const c of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = c[1], ref = attr(' ' + a, 'r'); const mm = /^([A-Z]+)(\d+)$/.exec(ref); if (!mm) continue;
      const t = attr(' ' + a, 't'), s = +attr(' ' + a, 's') || 0, body = c[2] || '';
      let v = '';
      if (t === 's') v = shared[+((/<v>([\s\S]*?)<\/v>/.exec(body) || [])[1])] ?? '';
      else if (t === 'inlineStr') v = texts(body);
      else v = unxml((/<v>([\s\S]*?)<\/v>/.exec(body) || [])[1] || '');
      (rows[mm[2]] = rows[mm[2]] || {})[mm[1]] = { v: String(v).trim(), fill: xfs[s] || '' };
    }
    sheets[name] = rows;
  }
  return sheets;
}

// ── 현장 폴더 찾기 ──
const normName = s => String(s || '').replace(/\([^)]*\)/g, '').replace(/[\s.,_\-~·()]/g, '').toLowerCase();
const dateKey = s => { const m = /^\s*(\d{2})\.\s*(\d{1,2})(?:\.\s*(\d{1,2}))?/.exec(String(s || '')); return m ? m[1] + m[2].padStart(2, '0') + (m[3] ? m[3].padStart(2, '0') : '') : ''; };
let folderCache = { at: 0, root: '', list: [] };
function scanFolders(root) {
  if (folderCache.root === root && Date.now() - folderCache.at < 60000) return folderCache.list;
  const list = [];
  const walk = (dir, depth) => {
    let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    let imgs = 0;
    for (const e of ents) if (e.isFile() && IMG.test(e.name)) imgs++;
    // 현장 폴더 안에 '보정본' 폴더가 있으면 그 폴더(보정한 최종 사진)를 이 현장의 사진으로 씁니다
    let fin = null;
    if (dir !== root) for (const e of ents) if (e.isDirectory() && /보정본/.test(e.name)) {
      try { const n = fs.readdirSync(path.join(dir, e.name)).filter(x => IMG.test(x)).length; if (n) { fin = { rel: path.relative(root, path.join(dir, e.name)), name: path.basename(dir), imgs: n }; break; } } catch (_) {}
    }
    if (fin) list.push(fin);
    else if (imgs && dir !== root) list.push({ rel: path.relative(root, dir), name: path.basename(dir), imgs });
    if (depth < 4) for (const e of ents) if (e.isDirectory() && !e.name.startsWith('.')) walk(path.join(dir, e.name), depth + 1);
  };
  if (isDir(root)) walk(root, 0);
  folderCache = { at: Date.now(), root, list };
  return list;
}
function grams(s) { const out = new Set(); const t = normName(s).replace(/^\d+/, ''); for (let i = 0; i + 3 <= t.length; i++) out.add(t.slice(i, i + 3)); return out; }
function matchFolder(name, folders) {
  const n = normName(name); if (!n) return null;
  const exact = folders.find(f => normName(f.name) === n); if (exact) return exact;
  const dk = dateKey(name), g = grams(name);
  let best = null, score = 0;
  for (const f of folders) {
    const fk = dateKey(f.name);
    if (dk && fk && !(fk.startsWith(dk) || dk.startsWith(fk))) continue;
    const fg = grams(f.name); let s = 0; for (const x of g) if (fg.has(x)) s++;
    if (s > score) { score = s; best = f; }
  }
  return score >= 4 ? best : null;
}

// ── 현장 목록 ──
const ITEM = { A: '주방', B: '붙박이장', C: '신발장', D: '화장대', E: '홈바장', F: '욕실장', G: '하프장', H: '기타장' };
// 시트에 쓰는 표기: "A", "A C", "AE /", "BD / A", "C(X)", "홈바", "기타장" …
// 붙여 쓴 글자(AE, BCD)는 한 글자씩 나눠 읽고, (X)는 '올리지 않기로 한 품목', 칸 전체가 X면 '제외'로 봅니다.
const WORD = [[/홈바/g, 'E'], [/기타장/g, 'H'], [/욕실장/g, 'F'], [/하프장/g, 'G']];
const lettersOf = t => [...new Set(String(t).toUpperCase().match(/(?<![A-Z])[A-H]+(?![A-Z])/g)?.join('').split('') || [])];
function parseCodes(raw) {
  let t = String(raw || ''), excluded = [];
  t = t.replace(/([A-Ha-h]+)\s*\(\s*[xX]\s*\)/g, (_, l) => { excluded.push(...lettersOf(l)); return ' '; });
  t = t.replace(/\([^)]*\)/g, ' ');
  for (const [re, c] of WORD) t = t.replace(re, ' ' + c + ' ');
  return { codes: lettersOf(t), excluded: [...new Set(excluded)] };
}
const codesOf = s => parseCodes(s).codes;
const excludedOf = s => parseCodes(s).excluded;
const allX = s => /^\s*[xX]\s*$/.test(String(s || ''));
const BLUE = /6699FF$/i;
// 스튜디오가 직접 알고 있는 진행 상황 — 시트(엑셀)에 적히기 전이라도 목록에 바로 보이게 합니다.
//  · 인스타 올림: <id>.post.json + <id>.done.json (30일 안) · 직접 올렸다고 남긴 <id>.insta.json (처리 전)
//  · 블로그 올림: <id>.blog.json (처리 전)
//  · 예약중: 아직 안 올라간 <id>.post.json
// 시트에는 아침 예약 작업이 적어요. 시트에 이미 적힌 글자는 그대로 두고, 없는 글자만 '시트 반영 대기'로 보여 줘요.
function queueOverlay(dir) {
  const ov = { daily: new Map(), blog: new Map(), queued: new Map() };
  if (!isDir(dir)) return ov;
  let names; try { names = fs.readdirSync(dir); } catch (_) { return ov; }
  const now = Date.now(), DAY = 864e5, has = new Set(names);
  const read = n => { try { return JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')); } catch (_) { return null; } };
  const add = (map, r, at, maxDays) => {
    if (!r || !r.siteName || !r.sheetTab || !Array.isArray(r.items)) return;
    if (at && now - at > maxDays * DAY) return;
    const key = r.sheetTab + '|' + normName(r.siteName), set = map.get(key) || new Set();
    for (const c of r.items) { const u = String(c).toUpperCase(); if (/^[A-H]$/.test(u)) set.add(u); }
    map.set(key, set);
  };
  for (const n of names) {
    let m;
    if ((m = /^(.+)\.post\.json$/.exec(n))) {
      const r = read(n); if (!r) continue;
      if (has.has(m[1] + '.done.json')) {
        const d = read(m[1] + '.done.json') || {};
        let at = +d.postedAt || 0; if (!at) { try { at = fs.statSync(path.join(dir, m[1] + '.done.json')).mtimeMs; } catch (_) {} }
        add(ov.daily, r, at, 30);
      } else if (!r.status || r.status === '게시 대기') add(ov.queued, r, r.createdAt || 0, 60);
    } else if ((m = /^(.+)\.insta\.json$/.exec(n))) {
      if (!has.has(m[1] + '.instadone.json')) add(ov.daily, read(n), (read(n) || {}).createdAt || 0, 60);
    } else if ((m = /^(.+)\.blog\.json$/.exec(n))) {
      if (!has.has(m[1] + '.blogdone.json')) add(ov.blog, read(n), (read(n) || {}).createdAt || 0, 60);
    }
  }
  return ov;
}
function buildSites(st) {
  const sheets = readWorkbook(st.sheetPath);
  const ov = queueOverlay(st.queueDir);
  const folders = scanFolders(st.photoRoot);
  const notes = {};
  const pr = sheets['사진정리'] || {};
  for (const r of Object.keys(pr)) {
    const row = pr[r]; if (+r === 1 || !row.A || !row.C) continue;
    const key = normName(row.A.v), code = row.C.v.trim().toUpperCase();
    const split = s => String(s || '').split(/\s*,\s*/).map(x => x.trim()).filter(Boolean);
    (notes[key] = notes[key] || {})[code] = { files: split(row.F && row.F.v), picks: split(row.G && row.G.v).map(x => x.replace(/\((?!\d+\))[^)]*\)/g, '').trim()).filter(Boolean), note: row.H ? row.H.v : '' };
  }
  const sites = [];
  for (const tab of ['26키코단독', '26레몬현장']) {
    const rows = sheets[tab] || {};
    for (const r of Object.keys(rows).map(Number).sort((a, b) => a - b)) {
      const row = rows[r]; if (r < 2 || !row.B || !row.B.v || row.B.v === '현장명') continue;
      const name = row.B.v, items = codesOf(row.I && row.I.v), daily = row.G ? row.G.v : '';
      const gx = allX(daily), excluded = gx ? items.slice() : excludedOf(daily);
      const sheetDone = [...new Set([...codesOf(daily), ...excluded])];
      const key = tab + '|' + normName(name);
      const ovDaily = [...(ov.daily.get(key) || [])].sort(), ovBlog = [...(ov.blog.get(key) || [])].sort(), ovQ = [...(ov.queued.get(key) || [])].sort();
      const dailyPending = ovDaily.filter(c => !sheetDone.includes(c));          // 스튜디오는 올린 걸 아는데 시트엔 아직 없는 품목
      const done = [...new Set([...sheetDone, ...ovDaily])];
      const queued = ovQ.filter(c => items.includes(c) && !done.includes(c));    // 이미 예약해 둔 품목 (중복 예약 방지용 표시)
      // 블로그(E열): 파랗게 칠했거나, 적힌 글자 + 제외((X))가 품목을 모두 덮으면 끝난 것
      const eRaw = row.E ? row.E.v : '', ep = parseCodes(eRaw), ex = allX(eRaw);
      const eDone = [...new Set([...ep.codes, ...(ex ? items : ep.excluded)])];
      const blogSheetDone = !!(row.E && (BLUE.test(row.E.fill) || /완료|o|✓/i.test(eRaw))) || ex || (items.length > 0 && items.every(c => eDone.includes(c)));
      const blogPending = ovBlog.filter(c => !eDone.includes(c));
      const blogAll = new Set([...eDone, ...ovBlog]);
      const blogDone = blogSheetDone || (items.length > 0 && items.every(c => blogAll.has(c)));
      const f = matchFolder(name, folders);
      sites.push({
        id: tab + ':' + r, tab, row: r, name, date: dateKey(name), seoul: /서울/.test(name) || /^theme5/.test(row.B.fill || ''),
        items, itemNames: items.map(c => ITEM[c]), daily, dailyDone: done.filter(c => !excluded.includes(c)), dailyPending, queued,
        remaining: items.filter(c => !done.includes(c)), excluded, hold: /보류/.test(daily),
        instaDone: !!(row.G && BLUE.test(row.G.fill)) || (items.length > 0 && items.every(c => done.includes(c))),
        blogDone, blogPending: blogSheetDone ? [] : blogPending,
        blogCodes: [...new Set([...ep.codes, ...ovBlog])],
        blogRemaining: blogDone ? [] : items.filter(c => !blogAll.has(c)),
        blogViaStudioOnly: blogDone && !blogSheetDone,
        folder: f ? f.rel : '', photoCount: f ? f.imgs : 0,
        notes: notes[normName(name)] || null
      });
    }
  }
  return sites;
}

// ── 큐 (구글 드라이브 동기화 폴더) ──
function listQueue(dir) {
  if (!isDir(dir)) return [];
  const names = fs.readdirSync(dir), out = [];
  for (const n of names) {
    if (!/\.post\.json$/.test(n)) continue;
    try {
      const p = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'));
      p.id = n.replace(/\.post\.json$/, '');
      // 예약 작업이 인스타에 올린 뒤 남기는 결과 파일 (<id>.done.json: status · permalink · postedAt)
      if (names.includes(p.id + '.done.json')) { try { Object.assign(p, JSON.parse(fs.readFileSync(path.join(dir, p.id + '.done.json'), 'utf8')), { status: '게시 완료' }); } catch (_) { p.status = '게시 완료'; } }
      p.missing = p.status === '게시 완료' ? [] : (p.photos || []).filter(x => !names.includes(x));
      out.push(p);
    } catch (_) {}
  }
  return out.sort((a, b) => String(a.scheduledDate).localeCompare(String(b.scheduledDate)) || (a.createdAt || 0) - (b.createdAt || 0));
}
// ── 예약 글 사진·글 묶음(zip) 받기 — 인스타 자동 게시가 안 될 때 직접 올릴 수 있게 (저장만 하는 zip, 외부 라이브러리 없음) ──
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = buf => { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function zipStore(entries) {
  const parts = [], central = []; let off = 0;
  const d = new Date(), dosT = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), dosD = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8'), data = e.data, crc = crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(0, 8); lh.writeUInt16LE(dosT, 10); lh.writeUInt16LE(dosD, 12); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(0, 10); ch.writeUInt16LE(dosT, 12); ch.writeUInt16LE(dosD, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
    parts.push(lh, name, data); central.push(ch, name); off += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}
const safeId = id => /^[^\\/:*?"<>|]+$/.test(String(id || '')) && !String(id).includes('..');

// ── 기억 (확정 캡션 · 고쳐달라고 한 내용) ──
function readMemory() {
  try { return JSON.parse(fs.readFileSync(MEM_FILE, 'utf8')); } catch (_) {}
  try { return JSON.parse(fs.readFileSync(SEED_MEM, 'utf8')); } catch (_) {}
  return { confirmed: [], feedback: [] };
}

async function handle(req, res, url) {
  const u = new URL(url, 'http://127.0.0.1'), p = u.pathname;
  try {
    try { fs.mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 }); } catch (_) {}
    const st = readSettings();
    if (p === '/api/insta/status') {
      return json(res, 200, { ok: true, settings: { ...st, fireToken: st.fireToken ? MASK : '' }, fire: { on: fireReady(st), last: LAST_FIRE }, sheetOk: exists(st.sheetPath), photoOk: isDir(st.photoRoot), queueOk: isDir(st.queueDir), queueName: QUEUE_NAME });
    }
    if (p === '/api/insta/settings' && req.method === 'POST') {
      const b = await readJson(req, 8192), cur = (() => { try { return JSON.parse(fs.readFileSync(SET_FILE, 'utf8')); } catch (_) { return {}; } })();
      for (const k of ['sheetPath', 'photoRoot', 'queueDir', 'exportDir']) if (k in b) cur[k] = String(b[k] || '').trim().replace(/^"|"$/g, '');
      if ('fireId' in b) { const m = /trig_[A-Za-z0-9]+/.exec(String(b.fireId || '')); cur.fireId = m ? m[0] : ''; }
      if ('fireToken' in b && String(b.fireToken) !== MASK) cur.fireToken = String(b.fireToken || '').trim();
      fs.writeFileSync(SET_FILE, JSON.stringify(cur, null, 1), { mode: 0o600 });
      folderCache.at = 0;
      return json(res, 200, { ok: true });
    }
    if (p === '/api/insta/fire-test' && req.method === 'POST') {
      if (!fireReady(st)) throw Error('루틴 ID와 토큰을 먼저 저장해 주세요.');
      const r = await fireCall(st, '연결 시험이에요. 바로 발행 요청(.now 파일)이 없으면 아무것도 하지 말고 "바로 발행 요청 없음"이라고만 남기고 끝내.');
      LAST_FIRE = { id: '연결 시험', at: Date.now(), state: r.ok ? '보냈어요' : '실패', ok: r.ok, why: r.why, session: r.session };
      return json(res, 200, { ok: true, fire: { on: true, last: LAST_FIRE } });
    }
    if (p === '/api/insta/sites') {
      if (!exists(st.sheetPath)) throw Error('개인 엑셀 시트를 찾지 못했어요: ' + st.sheetPath);
      if (u.searchParams.get('fresh')) folderCache.at = 0;
      return json(res, 200, { ok: true, sites: buildSites(st), photoRootOk: isDir(st.photoRoot) });
    }
    if (p === '/api/insta/photos') {
      const dir = path.resolve(st.photoRoot, u.searchParams.get('folder') || '');
      if (!dir.startsWith(path.resolve(st.photoRoot) + path.sep) || !isDir(dir)) throw Error('현장 폴더를 찾지 못했어요.');
      const files = fs.readdirSync(dir).filter(n => IMG.test(n)).sort((a, b) => a.localeCompare(b, 'ko', { numeric: true }));
      return json(res, 200, { ok: true, files });
    }
    if (p === '/api/insta/file') {
      const root = path.resolve(st.photoRoot);
      const file = path.resolve(root, u.searchParams.get('folder') || '', u.searchParams.get('name') || '');
      if (!file.startsWith(root + path.sep) || !IMG.test(file) || !exists(file)) { res.writeHead(404); return res.end(); }
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, { 'Content-Type': ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
      return fs.createReadStream(file).pipe(res);
    }
    if (p === '/api/insta/qzip') {          // 예약 글 하나의 사진(+스토리 사진)과 글을 zip 하나로 받기
      const id = u.searchParams.get('id') || '';
      if (!safeId(id) || !isDir(st.queueDir)) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('예약 글을 찾지 못했어요.'); }
      const post = listQueue(st.queueDir).find(x => x.id === id);
      if (!post) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('예약 글을 찾지 못했어요.'); }
      const dir = path.resolve(st.queueDir), entries = [], lost = [];
      (post.photos || []).forEach((n, i) => {
        const f = path.resolve(dir, n);
        if (f.startsWith(dir + path.sep) && exists(f)) entries.push({ name: String(i + 1).padStart(2, '0') + path.extname(n).toLowerCase(), data: fs.readFileSync(f) }); else lost.push(n);
      });
      if (post.storyPhoto) { const f = path.resolve(dir, post.storyPhoto); if (f.startsWith(dir + path.sep) && exists(f)) entries.push({ name: '스토리' + path.extname(post.storyPhoto).toLowerCase(), data: fs.readFileSync(f) }); }
      if (!entries.length) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('폴더에 사진이 없어요.'); }
      entries.push({ name: '글.txt', data: Buffer.from('\ufeff' + String(post.caption || post.body || '') + (lost.length ? '\r\n\r\n(폴더에 없어서 빠진 사진: ' + lost.join(', ') + ')' : ''), 'utf8') });
      const label = String(post.hashtag || post.apt || '인스타').replace(/[\\/:*?"<>|#\s]+/g, '') || '인스타';
      const buf = zipStore(entries);
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': buf.length, 'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(label + '_인스타_올리기용.zip'), 'Cache-Control': 'no-store' });
      return res.end(buf);
    }
    if (p === '/api/insta/qfile') {
      const dir = path.resolve(st.queueDir || '.'), name = u.searchParams.get('name') || '';
      const file = path.resolve(dir, name);
      if (!st.queueDir || !file.startsWith(dir + path.sep) || !/\.jpg$/i.test(file) || !exists(file)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' });
      return fs.createReadStream(file).pipe(res);
    }
    // 블로그로 보내는 사진을 영상 만들 때 쓰도록 컴퓨터 폴더(D:\김채현 키친앤코\26.11\11.3\현장 폴더명)에 복사해 둬요
    if (p === '/api/insta/export' && req.method === 'POST') {
      const b = await readJson(req, 65536), root = path.resolve(st.photoRoot);
      const src = path.resolve(root, String(b.folder || ''));
      if (!src.startsWith(root + path.sep) || !isDir(src)) throw Error('현장 폴더를 찾지 못했어요.');
      const names = (Array.isArray(b.names) ? b.names : []).map(String).filter(n => IMG.test(n) && !/[\\/]/.test(n)).slice(0, 80);
      if (!names.length) throw Error('내려받을 사진이 없어요.');
      // 현장 폴더 이름은 원드라이브 폴더 이름 그대로 (예: 26.06.15. 부산광역시 기장군 … (최연종))
      const vf = videodir.videoFolder(st.exportDir, path.basename(src) || b.label), dest = vf.dir;
      let n = 0; const failed = [];
      const copyOne = (from, to) => new Promise((ok, no) => {   // OneDrive '온라인 전용' 파일도 읽으면서 받아지도록 스트림으로 복사
        const rs = fs.createReadStream(from), ws = fs.createWriteStream(to);
        rs.on('error', no); ws.on('error', no); ws.on('finish', ok); rs.pipe(ws);
      });
      for (let i = 0; i < names.length; i++) {
        const name = names[i], from = path.join(src, name), to = path.join(dest, String(i + 1).padStart(2, '0') + '_' + name);
        if (!exists(from)) { failed.push(name + ' (원본 없음)'); continue; }
        try {
          let same = false; try { same = fs.statSync(to).size === fs.statSync(from).size && fs.statSync(to).size > 0; } catch (_) {}
          if (!same) { try { await copyOne(from, to); } catch (_) { await new Promise(r => setTimeout(r, 800)); await copyOne(from, to); } }
          n++;
        } catch (e) { failed.push(name + ' (' + (e.code || e.message) + ')'); }
      }
      return json(res, 200, { ok: true, dir: dest, count: n, total: names.length, failed, fallback: vf.fallback });
    }
    // 블로그 발행·예약을 마쳤다는 기록 — 예약 작업이 개인 시트 블로그(E열)에 반영해요
    if (p === '/api/insta/blogrecord' && req.method === 'POST') {
      if (!isDir(st.queueDir)) throw Error('구글 드라이브의 "' + QUEUE_NAME + '" 폴더를 찾지 못했어요. 인스타 탭의 [연결 설정]을 확인해 주세요.');
      const b = await readJson(req, 16384);
      const letters = [...new Set((Array.isArray(b.items) ? b.items : []).map(x => String(x).toUpperCase()).filter(x => /^[A-H]$/.test(x)))].sort();
      if (!b.siteName || !b.sheetTab || !letters.length) throw Error('현장과 품목이 필요해요.');
      // 같은 요청이 아직 처리 전이면 새로 만들지 않아요 (버튼을 두 번 눌러도, 임시저장을 다시 해도 한 번만)
      const names = fs.readdirSync(st.queueDir);
      for (const n of names) {
        const m = /^(.+)\.blog\.json$/.exec(n); if (!m || names.includes(m[1] + '.blogdone.json')) continue;
        try {
          const r = JSON.parse(fs.readFileSync(path.join(st.queueDir, n), 'utf8'));
          if (r.siteName === String(b.siteName) && r.sheetTab === String(b.sheetTab) && JSON.stringify([...(r.items || [])].sort()) === JSON.stringify(letters)) return json(res, 200, { ok: true, id: m[1], dup: true });
        } catch (_) {}
      }
      const day = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
      const id = day + '_blog_' + crypto.randomBytes(3).toString('hex');
      const rec = { kind: 'blog', status: '시트 기록 대기', source: b.auto ? 'auto-draft' : 'manual', siteName: String(b.siteName), sheetTab: String(b.sheetTab), sheetRow: b.sheetRow || null, items: letters, apt: String(b.apt || ''), createdAt: Date.now() };
      fs.writeFileSync(path.join(st.queueDir, id + '.blog.json'), JSON.stringify(rec, null, 1), 'utf8');
      return json(res, 200, { ok: true, id });
    }
    // 아직 시트에 반영되기 전인 기록 요청(블로그 · 인스타)을 취소해요 — 이미 처리된 건 취소할 수 없어요
    if (p === '/api/insta/recordcancel' && req.method === 'POST') {
      if (!isDir(st.queueDir)) throw Error('구글 드라이브의 "' + QUEUE_NAME + '" 폴더를 찾지 못했어요.');
      const b = await readJson(req, 2048), id = String(b.id || '');
      if (!/^\d{4}-\d{2}-\d{2}_(blog|ig)_[0-9a-f]{6}$/.test(id)) throw Error('기록 번호가 올바르지 않아요.');
      const kind = id.includes('_blog_') ? 'blog' : 'insta', file = path.join(st.queueDir, id + '.' + kind + '.json');
      if (fs.existsSync(path.join(st.queueDir, id + (kind === 'blog' ? '.blogdone.json' : '.instadone.json')))) throw Error('이미 시트에 기록된 건이라 취소할 수 없어요.');
      if (!fs.existsSync(file)) throw Error('이미 없는 기록이에요.');
      fs.rmSync(file, { force: true });
      return json(res, 200, { ok: true });
    }
    // 스튜디오 밖(인스타 앱 등)에서 직접 올린 글을 시트 데일리(G열)에 기록해 달라는 요청 — 예약 작업이 처리해요
    if (p === '/api/insta/instarecord' && req.method === 'POST') {
      if (!isDir(st.queueDir)) throw Error('구글 드라이브의 "' + QUEUE_NAME + '" 폴더를 찾지 못했어요. 인스타 탭의 [연결 설정]을 확인해 주세요.');
      const b = await readJson(req, 16384);
      const letters = [...new Set((Array.isArray(b.items) ? b.items : []).map(x => String(x).toUpperCase()).filter(x => /^[A-H]$/.test(x)))].sort();
      if (!b.siteName || !b.sheetTab || !letters.length) throw Error('현장과 품목이 필요해요.');
      // 같은 요청이 아직 처리 전이면 새로 만들지 않아요 (버튼을 두 번 눌러도 한 번만)
      const names = fs.readdirSync(st.queueDir);
      for (const n of names) {
        const m = /^(.+)\.insta\.json$/.exec(n); if (!m || names.includes(m[1] + '.instadone.json')) continue;
        try {
          const r = JSON.parse(fs.readFileSync(path.join(st.queueDir, n), 'utf8'));
          if (r.siteName === String(b.siteName) && r.sheetTab === String(b.sheetTab) && JSON.stringify([...(r.items || [])].sort()) === JSON.stringify(letters)) return json(res, 200, { ok: true, id: m[1], dup: true });
        } catch (_) {}
      }
      const day = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
      const id = day + '_ig_' + crypto.randomBytes(3).toString('hex');
      const rec = { kind: 'insta', status: '시트 기록 대기', source: 'manual', siteName: String(b.siteName), sheetTab: String(b.sheetTab), sheetRow: b.sheetRow || null, items: letters, apt: String(b.apt || ''), createdAt: Date.now() };
      fs.writeFileSync(path.join(st.queueDir, id + '.insta.json'), JSON.stringify(rec, null, 1), 'utf8');
      return json(res, 200, { ok: true, id });
    }
    // 시트 기록 요청 목록(블로그 · 인스타) — 예약 작업이 처리했는지(…done.json)까지 같이 알려 줘요
    if (p === '/api/insta/records' && req.method === 'GET') {
      if (!isDir(st.queueDir)) return json(res, 200, { ok: true, queueOk: false, records: [] });
      const names = fs.readdirSync(st.queueDir), out = [];
      for (const n of names) {
        const m = /^(.+)\.(blog|insta)\.json$/.exec(n); if (!m) continue;
        try {
          const r = JSON.parse(fs.readFileSync(path.join(st.queueDir, n), 'utf8'));
          const doneName = m[1] + (m[2] === 'blog' ? '.blogdone.json' : '.instadone.json');
          let done = false, doneAt = 0;
          if (names.includes(doneName)) { done = true; try { doneAt = +JSON.parse(fs.readFileSync(path.join(st.queueDir, doneName), 'utf8')).at || 0; } catch (_) {} }
          out.push({ id: m[1], kind: m[2], siteName: r.siteName || '', items: Array.isArray(r.items) ? r.items : [], createdAt: r.createdAt || 0, auto: r.source === 'auto-draft', done, doneAt });
        } catch (_) {}
      }
      out.sort((a, b) => b.createdAt - a.createdAt);
      return json(res, 200, { ok: true, queueOk: true, records: out.slice(0, 12) });
    }
    if (p === '/api/insta/queue' && req.method === 'GET') {
      return json(res, 200, { ok: true, queueOk: isDir(st.queueDir), queueDir: st.queueDir, posts: listQueue(st.queueDir) });
    }
    if (p === '/api/insta/queue' && req.method === 'POST') {
      if (!isDir(st.queueDir)) throw Error('구글 드라이브의 "' + QUEUE_NAME + '" 폴더를 찾지 못했어요. 인스타 탭의 [연결 설정]을 확인해 주세요.');
      const b = await readJson(req, 120 * 1024 * 1024), post = b.post || {}, imgs = b.images || [];
      if (!post.caption || !post.scheduledDate || !/^\d{4}-\d{2}-\d{2}$/.test(post.scheduledDate)) throw Error('글과 게시 날짜가 필요해요.');
      if (!imgs.length || imgs.length > 10) throw Error('사진은 1~10장이어야 해요.');
      const slug = String(post.apt || '현장').replace(/[\\/:*?"<>|\s#]/g, '').slice(0, 30) || '현장';
      const id = post.scheduledDate + '_' + slug + '_' + crypto.randomBytes(2).toString('hex');
      const photos = [];
      imgs.forEach((d, i) => {
        const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(d || ''));
        if (!m) throw Error((i + 1) + '번째 사진 형식이 올바르지 않아요.');
        const name = id + '_' + (i + 1) + '.jpg';
        fs.writeFileSync(path.join(st.queueDir, name), Buffer.from(m[1], 'base64'), { flag: 'wx' });
        photos.push(name);
      });
      const out = { ...post, photos, status: '게시 대기', createdAt: Date.now(), source: 'studio', ratio: ['4:5', '1:1', '4:3', '3:2', '1.91:1'].includes(post.ratio) ? post.ratio : '4:5' };   // 인스타 피드는 4:5~1.91:1만 올릴 수 있어요
      delete out.id; delete out.missing; delete out.storyPhoto;
      // 스토리: 첫 사진을 9:16 배경에 얹은 이미지 (게시가 끝난 뒤 예약 작업이 스토리로 공유)
      out.story = !!b.story;
      if (b.story) {
        const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(b.story));
        if (!m) throw Error('스토리 이미지 형식이 올바르지 않아요.');
        out.storyPhoto = id + '_story.jpg';
        fs.writeFileSync(path.join(st.queueDir, out.storyPhoto), Buffer.from(m[1], 'base64'), { flag: 'wx' });
      }
      // 먼저 사진·글을 쓰고, 마지막에 '바로 발행' 표시 파일을 만들어요 (예약 작업이 이 표시를 보고 바로 올려요)
      fs.writeFileSync(path.join(st.queueDir, id + '.post.json'), JSON.stringify(out, null, 1), 'utf8');
      if (out.postNow) fs.writeFileSync(path.join(st.queueDir, id + '.now'), 'now', 'utf8');
      return json(res, 200, { ok: true, id, fire: out.postNow ? fireNow(st, id) : false });
    }
    if (p === '/api/insta/queue/update' && req.method === 'POST') {
      const b = await readJson(req, 65536); if (!safeId(b.id)) throw Error('잘못된 요청이에요.');
      const f = path.join(st.queueDir, b.id + '.post.json'); const cur = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (cur.status === '게시 완료') throw Error('이미 올라간 글은 바꿀 수 없어요.');
      if (b.postNow) { cur.postNow = true; cur.scheduledDate = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); fs.writeFileSync(path.join(st.queueDir, b.id + '.now'), 'now', 'utf8'); }
      else if (b.scheduledDate) { if (!/^\d{4}-\d{2}-\d{2}$/.test(b.scheduledDate)) throw Error('날짜 형식이 올바르지 않아요.'); cur.scheduledDate = b.scheduledDate; }
      if (typeof b.caption === 'string' && b.caption.trim()) { cur.caption = b.caption; if (typeof b.body === 'string') cur.body = b.body; }
      fs.writeFileSync(f, JSON.stringify(cur, null, 1), 'utf8');
      return json(res, 200, { ok: true, fire: b.postNow ? fireNow(st, b.id) : false });
    }
    if (p === '/api/insta/queue/remove' && req.method === 'POST') {
      const b = await readJson(req, 4096); if (!safeId(b.id) || !isDir(st.queueDir)) throw Error('잘못된 요청이에요.');
      for (const n of fs.readdirSync(st.queueDir)) if (n === b.id + '.post.json' || n === b.id + '.done.json' || n === b.id + '.now' || n === b.id + '.claim' || n === b.id + '.failed' || (n.startsWith(b.id + '_') && /\.jpg$/i.test(n))) fs.rmSync(path.join(st.queueDir, n), { force: true });
      return json(res, 200, { ok: true });
    }
    // 캡션 문체 예시 — 사장님이 직접 확정한 키친앤코 본문(data/style-corpus.json)에서 이번 현장 품목·컬러와 가까운 것을 골라 줘요
    if (p === '/api/insta/style' && req.method === 'GET') {
      const items = String(u.searchParams.get('items') || '').split(',').filter(x => /^[A-H]$/.test(x));
      const tones = String(u.searchParams.get('tones') || '').split(',').map(x => x.trim()).filter(Boolean);
      const n = Math.max(1, Math.min(16, +u.searchParams.get('n') || 8)), m = Math.max(0, Math.min(10, +u.searchParams.get('m') || 5));
      const S = styleCorpus();
      return json(res, 200, { ok: true, examples: pickStyle(S.examples, items, tones, n), short: pickStyle(S.short, items, tones, m), phrases: S.phrases || [], total: (S.examples || []).length + (S.short || []).length });
    }
    if (p === '/api/insta/memory' && req.method === 'GET') return json(res, 200, { ok: true, ...readMemory() });
    if (p === '/api/insta/memory' && req.method === 'POST') {
      const b = await readJson(req, 65536), m = readMemory();
      if (b.confirmed) m.confirmed = [String(b.confirmed), ...(m.confirmed || []).filter(x => x !== b.confirmed)].slice(0, 40);
      if (b.feedback) m.feedback = [String(b.feedback), ...(m.feedback || [])].slice(0, 60);
      fs.writeFileSync(MEM_FILE, JSON.stringify(m, null, 1), { mode: 0o600 });
      return json(res, 200, { ok: true });
    }
    json(res, 404, { ok: false, error: '없는 기능이에요.' });
  } catch (e) { json(res, 400, { ok: false, error: e.message || '요청 실패' }); }
}
module.exports = { handle, _test: { readWorkbook, buildSites, matchFolder, dateKey, scanFolders } };
