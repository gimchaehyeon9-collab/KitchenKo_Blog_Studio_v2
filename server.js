// 키친앤코 블로그 스튜디오 v2 — 로컬 전용 서버 (npm 설치 불필요, Node.js 18+)
// 역할: 1) 화면 파일 제공  2) 네이버 사진 업로드용 임시 파일 준비/정리
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const insta = require('./insta.js');   // 2.9.0 — 현장 · 인스타 탭
const lemon = require('./lemon.js');   // 2.10.0 — 레몬하우스 모드
const rank = require('./rank.js');     // 2.10.16 — 블로그 링크·네이버 노출 순위 기록
const landimg = require('./landimg.js');   // 2.10.23 — 네이버 부동산 도면 이미지 받아 오기
const cafehost = require('./cafehost.js');   // 2.10.30 — 레몬하우스 [카페 공사전·중] 탭 (카페 프로그램 같이 켜기)
const igapi = require('./igapi.js');   // 2.10.39 — 인스타 토큰을 이 PC 에 보관 + 인스타 API 대리 호출

const APP = 'kitchenko-blog-studio';
const VERSION = 3036;
const PORT = Number(process.env.KEYCHEN_PORT || 4540);
const PUBLIC = path.join(__dirname, 'public');
const ORIGIN = 'http://127.0.0.1:' + PORT;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon'
};

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
async function readJson(req, cap) {
  const chunks = []; let n = 0;
  for await (const ch of req) { n += ch.length; if (n > cap) throw Error('전송 용량이 너무 큽니다.'); chunks.push(ch); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

// ── 사진 임시 파일 (크롬 확장이 네이버 사진 버튼에 실제 파일 경로를 넣기 위해 필요) ──
const STAGE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'kitchenko-photos-'));
const JOBS = new Map();
async function stagePhotos(req, res) {
  try {
    const body = await readJson(req, 160 * 1024 * 1024);
    const images = body && body.images;
    if (!Array.isArray(images) || images.length < 1 || images.length > 40) throw Error('사진은 1~40장까지 전송할 수 있습니다.');
    const job = crypto.randomUUID();
    const dir = path.join(STAGE_ROOT, job);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const files = [];
    try {
      images.forEach((im, i) => {
        const hit = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(im && im.data || ''));
        if (!hit) throw Error((i + 1) + '번째 사진 형식이 올바르지 않습니다.');
        const bytes = Buffer.from(hit[2], 'base64');
        if (bytes.length < 100 || bytes.length > 25 * 1024 * 1024) throw Error((i + 1) + '번째 사진 크기가 올바르지 않습니다.');
        const ext = hit[1] === 'jpeg' ? 'jpg' : hit[1];
        const name = String(i + 1).padStart(2, '0') + '_' + (im.kind === 'cover' ? 'cover' : 'photo') + '.' + ext;
        const file = path.join(dir, name);
        fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 });
        files.push({ id: String(im.id), filePath: file });
      });
    } catch (e) { fs.rmSync(dir, { recursive: true, force: true }); throw e; }
    JOBS.set(job, { dir, created: Date.now() });
    json(res, 200, { ok: true, jobId: job, images: files });
  } catch (e) { json(res, 400, { ok: false, error: e.message || '사진 준비 실패' }); }
}
// 동영상은 크기가 커서 원본 그대로(바이너리) 받습니다
async function stageVideo(req, res) {
  try {
    const name = decodeURIComponent(String(req.headers['x-filename'] || 'video.mp4'));
    const ext = (/\.(mp4|mov|m4v|avi|wmv|mkv|webm)$/i.exec(name) || [, 'mp4'])[1].toLowerCase();
    const job = crypto.randomUUID(), dir = path.join(STAGE_ROOT, job);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, 'video.' + ext);
    const out = fs.createWriteStream(file, { mode: 0o600 }); let n = 0;
    for await (const ch of req) { n += ch.length; if (n > 4 * 1024 * 1024 * 1024) { out.destroy(); fs.rmSync(dir, { recursive: true, force: true }); throw Error('동영상은 4GB까지 가능합니다.'); } if (!out.write(ch)) await new Promise(r => out.once('drain', r)); }
    await new Promise(r => out.end(r));
    if (n < 1000) { fs.rmSync(dir, { recursive: true, force: true }); throw Error('동영상 파일이 비어 있습니다.'); }
    JOBS.set(job, { dir, created: Date.now() });
    json(res, 200, { ok: true, jobId: job, filePath: file });
  } catch (e) { json(res, 400, { ok: false, error: e.message || '동영상 준비 실패' }); }
}
async function cleanupPhotos(req, res) {
  try {
    const { jobId } = await readJson(req, 4096);
    const j = JOBS.get(String(jobId || ''));
    if (j) { fs.rmSync(j.dir, { recursive: true, force: true }); JOBS.delete(String(jobId)); }
    json(res, 200, { ok: true });
  } catch (_) { json(res, 400, { ok: false }); }
}
setInterval(() => {
  for (const [id, j] of JOBS) if (Date.now() - j.created > 90 * 60 * 1000) { fs.rmSync(j.dir, { recursive: true, force: true }); JOBS.delete(id); }
}, 60000).unref();
const cleanupAll = () => { try { fs.rmSync(STAGE_ROOT, { recursive: true, force: true }); } catch (_) {} };
process.on('exit', cleanupAll);
process.on('SIGINT', () => process.exit(0));

// ── 네이버 검색광고 API (공식) — 키는 이 PC의 .searchad.json 에만 저장됩니다 ──
// 키는 프로그램 폴더가 아니라 '내 PC 사용자 폴더'에 저장 → 새 버전으로 바꿔도 다시 입력할 필요 없음
const KEY_DIR = path.join(os.homedir(), '.kitchenko-studio');
try { fs.mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 }); } catch (_) {}
const CRED_FILE = path.join(KEY_DIR, 'searchad.json');
const AI_FILE = path.join(KEY_DIR, 'claude.json');
// 예전 버전(프로그램 폴더)에 저장된 키가 있으면 옮겨 옴
try { const old = path.join(__dirname, '.searchad.json'); if (fs.existsSync(old) && !fs.existsSync(CRED_FILE)) fs.copyFileSync(old, CRED_FILE); } catch (_) {}
const readAiKey = () => { try { return JSON.parse(fs.readFileSync(AI_FILE, 'utf8')).apiKey || ''; } catch (_) { return ''; } };
const readCreds = () => { try { const c = JSON.parse(fs.readFileSync(CRED_FILE, 'utf8')); return c.customerId && c.apiKey && c.secretKey ? c : null; } catch (_) { return null; } };
async function settings(req, res) {
  if (req.method === 'GET') { const c = readCreds(); return json(res, 200, { ok: true, hasCreds: !!c, customerId: c ? c.customerId : '', hasAi: !!readAiKey() }); }
  try {
    const b = await readJson(req, 8192);
    if (b.clear) { try { fs.unlinkSync(CRED_FILE); } catch (_) {} return json(res, 200, { ok: true, hasCreds: false }); }
    if ('aiKey' in b) {
      const k = String(b.aiKey || '').trim();
      if (!k) { try { fs.unlinkSync(AI_FILE); } catch (_) {} return json(res, 200, { ok: true, hasAi: false }); }
      if (!/^sk-ant-/.test(k)) throw Error('Claude API 키는 sk-ant- 로 시작해요.');
      fs.writeFileSync(AI_FILE, JSON.stringify({ apiKey: k }), { mode: 0o600 });
      return json(res, 200, { ok: true, hasAi: true });
    }
    const c = { customerId: String(b.customerId || '').trim(), apiKey: String(b.apiKey || '').trim(), secretKey: String(b.secretKey || '').trim() };
    if (!/^\d+$/.test(c.customerId) || c.apiKey.length < 10 || c.secretKey.length < 10) throw Error('고객 ID(숫자), 액세스 라이선스, 비밀키를 모두 확인해 주세요.');
    fs.writeFileSync(CRED_FILE, JSON.stringify(c), { mode: 0o600 });
    json(res, 200, { ok: true, hasCreds: true });
  } catch (e) { json(res, 400, { ok: false, error: e.message }); }
}
async function keywordTool(req, res) {
  try {
    const c = readCreds(); if (!c) throw Error('검색광고 API 키가 설정되지 않았습니다.');
    const { keywords } = await readJson(req, 65536);
    const list = [...new Set((keywords || []).map(k => String(k).replace(/\s+/g, '')).filter(Boolean))].slice(0, 50);
    const rows = new Map();
    for (let i = 0; i < list.length; i += 5) {
      const ts = String(Date.now()), uri = '/keywordstool';
      const sig = crypto.createHmac('sha256', c.secretKey).update(ts + '.GET.' + uri).digest('base64');
      const r = await fetch('https://api.searchad.naver.com' + uri + '?showDetail=1&hintKeywords=' + encodeURIComponent(list.slice(i, i + 5).join(',')), {
        headers: { 'X-Timestamp': ts, 'X-API-KEY': c.apiKey, 'X-Customer': c.customerId, 'X-Signature': sig }
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw Error('검색광고 API 오류 ' + r.status + ': ' + (body.title || body.message || '키를 확인해 주세요'));
      for (const k of body.keywordList || []) rows.set(k.relKeyword, { keyword: k.relKeyword, pc: k.monthlyPcQcCnt, mobile: k.monthlyMobileQcCnt });
      await new Promise(r2 => setTimeout(r2, 250));
    }
    json(res, 200, { ok: true, rows: [...rows.values()].slice(0, 1500) });
  } catch (e) { json(res, 400, { ok: false, error: /fetch failed|ENOTFOUND|ECONN/.test(String(e.message)) ? '네이버 검색광고 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.' : e.message }); }
}

// ── Claude API (선택) — 사진을 보고 기존 글 문체로 작성 ──
async function aiWrite(req, res) {
  try {
    const key = readAiKey(); if (!key) throw Error('Claude API 키가 없습니다. 복사·붙여넣기 방식을 이용해 주세요.');
    const b = await readJson(req, 60 * 1024 * 1024);
    const content = [];
    for (const im of (b.images || []).slice(0, 30)) {
      const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(String(im.data || '')); if (!m) continue;
      if (im.label) content.push({ type: 'text', text: im.label });
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/' + m[1], data: m[2] } });
    }
    content.push({ type: 'text', text: String(b.prompt || '') });
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: b.model || 'claude-sonnet-5-5', max_tokens: 4000, messages: [{ role: 'user', content }] })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Error('Claude API 오류 ' + r.status + ': ' + (j.error && j.error.message || '키·잔액을 확인해 주세요'));
    json(res, 200, { ok: true, text: (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n') });
  } catch (e) { json(res, 400, { ok: false, error: /fetch failed|ENOTFOUND|ECONN/.test(String(e.message)) ? 'Claude 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.' : e.message }); }
}


// ── Claude Code(-p)로 사진 보고 쓰기 — 이 PC에 설치·로그인된 claude 를 그대로 사용 (구독 요금제, API 키 불필요) ──
const CLAUDE_BIN = process.env.KK_CLAUDE_BIN || 'claude';
const WIN = process.platform === 'win32';
const CLAUDE_ENV = () => { const e = { ...process.env, NO_COLOR: '1' }; delete e.ANTHROPIC_API_KEY; delete e.ANTHROPIC_AUTH_TOKEN; return e; };   // API 키가 있으면 요금이 나가므로 제거 → 구독 로그인만 사용
function runClaude(args, { input = '', cwd, timeout = 10 * 60 * 1000, onProc } = {}) {
  return new Promise(resolve => {
    let out = '', err = '', done = false, p;
    const fin = r => { if (done) return; done = true; clearTimeout(t); resolve({ out, err, ...r }); };
    try { p = spawn(CLAUDE_BIN, args, { cwd, env: CLAUDE_ENV(), shell: WIN, windowsHide: true }); }
    catch (e) { return resolve({ out: '', err: String(e.message), code: -1, missing: true }); }
    if (onProc) onProc(p);
    const t = setTimeout(() => { try { p.kill(); } catch (_) {} fin({ code: -2, timeout: true }); }, timeout);
    p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
    p.on('error', e => fin({ code: -1, err: String(e.message), missing: e.code === 'ENOENT' }));
    p.on('close', code => fin({ code }));
    p.stdin.on('error', () => {}); p.stdin.end(input);
  });
}
async function claudeCheck(req, res) {
  const v = await runClaude(['--version'], { timeout: 20000 });
  if (v.missing || (v.code !== 0 && !v.out.trim())) return json(res, 200, { ok: true, installed: false });
  const a = await runClaude(['auth', 'status'], { timeout: 20000 });
  let st = {}; try { st = JSON.parse(a.out); } catch (_) {}
  json(res, 200, { ok: true, installed: true, version: v.out.trim(), loggedIn: a.code === 0 && st.authMethod && st.authMethod !== 'none', authMethod: st.authMethod || '' });
}
const CLAUDE_JOBS = new Map();
async function claudeStart(req, res) {
  try {
    const b = await readJson(req, 80 * 1024 * 1024);
    const imgs = (b.images || []).slice(0, 40);
    if (!imgs.length) throw Error('사진이 없습니다.');
    const id = crypto.randomUUID(), dir = path.join(STAGE_ROOT, 'claude-' + id);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const names = [];
    for (const im of imgs) {
      const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(String(im.data || '')); if (!m) continue;
      const name = String(im.name || '').replace(/[^0-9A-Za-z_.-]/g, '') || ('p' + (names.length + 1) + '.jpg');
      fs.writeFileSync(path.join(dir, name), Buffer.from(m[2], 'base64'), { mode: 0o600 }); names.push(name);
    }
    if (!names.length) throw Error('사진 형식이 올바르지 않습니다.');
    const job = { id, state: 'running', started: Date.now(), result: '', error: '', dir };
    CLAUDE_JOBS.set(id, job);
    const prompt = '현재 폴더에 시공 사진 파일이 있습니다: ' + names.join(', ') + '\nRead 도구로 이 사진 파일들을 모두 직접 열어서 눈으로 확인한 뒤, 아래 요청대로 작성하세요. 시간을 아끼도록 Read는 한 번에 여러 개(가능하면 전부)를 동시에 호출하고, 사진을 다 연 뒤에는 다른 도구 없이 바로 답하세요. 파일 이름 앞 번호가 문단 번호입니다. 다른 도구는 쓰지 마세요.\n\n' + String(b.prompt || '');
    const args = ['-p', '--output-format', 'json', '--tools', 'Read', '--allowedTools', 'Read', '--permission-mode', 'dontAsk', '--disable-slash-commands', '--no-session-persistence', '--max-turns', '40'];
    if (b.model) args.push('--model', String(b.model).replace(/[^A-Za-z0-9._-]/g, ''));
    runClaude(args, { input: prompt, cwd: dir, onProc: p => { job.proc = p; } }).then(r => {
      let j = null; try { j = JSON.parse(r.out); } catch (_) {}
      if (r.missing) { job.state = 'error'; job.error = 'NOT_INSTALLED'; }
      else if (r.timeout) { job.state = 'error'; job.error = '10분이 지나도 끝나지 않아 멈췄어요.'; }
      else if (job.cancelled) { job.state = 'error'; job.error = '취소했어요.'; }
      else if (j && !j.is_error && typeof j.result === 'string' && j.result.trim()) { job.state = 'done'; job.result = j.result; }
      else { job.state = 'error'; job.error = (j && (j.result || j.error)) || (r.err || r.out || '알 수 없는 오류').toString().slice(0, 600); }
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    });
    json(res, 200, { ok: true, id });
  } catch (e) { json(res, 400, { ok: false, error: e.message || '요청 실패' }); }
}
function claudeJob(req, res) {
  const id = new URL(req.url, ORIGIN).searchParams.get('id'), j = CLAUDE_JOBS.get(id);
  if (!j) return json(res, 404, { ok: false, error: '작업을 찾지 못했어요.' });
  json(res, 200, { ok: true, state: j.state, result: j.result, error: j.error, seconds: Math.round((Date.now() - j.started) / 1000) });
}
function claudeCancel(req, res) {
  const id = new URL(req.url, ORIGIN).searchParams.get('id'), j = CLAUDE_JOBS.get(id);
  if (j && j.state === 'running') { j.cancelled = true; try { j.proc.kill(); } catch (_) {} }
  json(res, 200, { ok: true });
}


// ── 아파트명 → 지역 자동 찾기 (네이버 지도 공개 검색, 키 불필요) ──
const SIDO = { '서울특별시': '서울', '부산광역시': '부산', '대구광역시': '대구', '인천광역시': '인천', '광주광역시': '광주', '대전광역시': '대전', '울산광역시': '울산', '세종특별자치시': '세종', '경기도': '경기', '강원특별자치도': '강원', '강원도': '강원', '충청북도': '충북', '충청남도': '충남', '전북특별자치도': '전북', '전라북도': '전북', '전라남도': '전남', '경상북도': '경북', '경상남도': '경남', '제주특별자치도': '제주' };
const shortAddr = a => {
  const w = String(a || '').trim().split(/\s+/); if (w.length < 2) return '';
  const sido = SIDO[w[0]] || w[0];
  const out = [sido];
  for (let i = 1; i < w.length && out.length < 3; i++) { if (/(시|군|구)$/.test(w[i]) || /(동|읍|면|가|리)$/.test(w[i])) out.push(w[i]); else break; }
  return out.join(' ');
};
const HDR = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36', 'referer': 'https://map.naver.com/', 'accept': 'application/json, text/plain, */*', 'accept-language': 'ko-KR,ko;q=0.9' };
async function placeLookup(req, res) {
  const q = (new URL(req.url, ORIGIN).searchParams.get('q') || '').trim();
  if (q.length < 2) return json(res, 200, { ok: true, places: [] });
  const tried = [];
  const grab = async (url, pickFn) => {
    try {
      const r = await fetch(url, { headers: HDR, signal: AbortSignal.timeout(8000) });
      if (!r.ok) { tried.push(r.status); return []; }
      return pickFn(await r.json()) || [];
    } catch (e) { tried.push(String(e.name || e.message).slice(0, 30)); return []; }
  };
  let places = await grab('https://map.naver.com/p/api/search/allSearch?query=' + encodeURIComponent(q) + '&type=all&searchCoord=&boundary=',
    j => ((j.result && j.result.place && j.result.place.list) || []).map(p => ({ name: p.title || p.name, address: p.address || p.roadAddress || '' })));
  if (!places.length) places = await grab('https://m.map.naver.com/search2/searchMore.naver?query=' + encodeURIComponent(q) + '&page=1&displayCount=10&type=SITE_1',
    j => ((j.result && j.result.site && j.result.site.list) || []).map(p => ({ name: (p.name || '').replace(/<[^>]+>/g, ''), address: p.address || p.roadAddress || '' })));
  const out = [];
  for (const p of places.slice(0, 8)) {
    const region = shortAddr(p.address); if (!region) continue;
    if (!out.some(x => x.region === region && x.name === p.name)) out.push({ name: String(p.name || '').replace(/<[^>]+>/g, ''), region, address: p.address });
  }
  json(res, 200, { ok: true, places: out, tried: out.length ? undefined : tried });
}

// ── 네이버 부동산 도면 이미지 (네이버 이미지 서버 주소만, 내 PC 서버가 받아서 화면에 돌려줘요) ──
async function landImage(req, res) {
  try {
    const b = await readJson(req, 8192);
    const r = await landimg.fetchLandImage(b && b.url);
    json(res, 200, { ok: true, data: r.data, bytes: r.bytes, mime: r.mime });
  } catch (e) { json(res, 400, { ok: false, error: e.message || '도면을 받지 못했어요.' }); }
}

// ── 카페 글 속 이미지 (공사범위 표 사진 등 · 네이버 이미지 서버 주소만) ──
async function cafeImage(req, res) {
  try {
    const b = await readJson(req, 8192);
    const r = await landimg.fetchCafeImage(b && b.url);
    json(res, 200, { ok: true, data: r.data, bytes: r.bytes, mime: r.mime });
  } catch (e) { json(res, 400, { ok: false, error: e.message || '카페 사진을 받지 못했어요.' }); }
}

// ── 정적 파일 ──
function serveStatic(req, res) {
  let rel = decodeURIComponent((req.url || '/').split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = req.url || '/';
  // 다른 웹사이트에서 로컬 API를 호출하지 못하도록 차단
  if (url.startsWith('/api/') && req.headers.origin && req.headers.origin !== ORIGIN) return json(res, 403, { error: '로컬 프로그램에서만 사용할 수 있습니다.' });
  if (req.method === 'GET' && url === '/health') return json(res, 200, { ok: true, app: APP, version: VERSION, root: __dirname });
  if (url === '/api/settings' && (req.method === 'GET' || req.method === 'POST')) return settings(req, res);
  if (req.method === 'POST' && url === '/api/keywords') return keywordTool(req, res);
  if (req.method === 'POST' && url === '/api/ai') return aiWrite(req, res);
  if (req.method === 'GET' && url.startsWith('/api/place')) return placeLookup(req, res);
  if (req.method === 'GET' && url === '/api/claude/check') return claudeCheck(req, res);
  if (req.method === 'POST' && url === '/api/claude/start') return claudeStart(req, res);
  if (req.method === 'GET' && url.startsWith('/api/claude/job')) return claudeJob(req, res);
  if (req.method === 'POST' && url.startsWith('/api/claude/cancel')) return claudeCancel(req, res);
  if (req.method === 'POST' && url === '/api/media/stage') return stagePhotos(req, res);
  if (req.method === 'POST' && url === '/api/media/stage-video') return stageVideo(req, res);
  if (req.method === 'POST' && url === '/api/media/cleanup') return cleanupPhotos(req, res);
  if (req.method === 'POST' && url === '/api/land/image') return landImage(req, res);
  if (req.method === 'POST' && url === '/api/cafe/image') return cafeImage(req, res);
  if (url.startsWith('/api/ig/')) return igapi.handle(req, res, url);
  if (url.startsWith('/api/insta/')) return insta.handle(req, res, url);
  if (url.startsWith('/api/lemon/')) return lemon.handle(req, res, url);
  if (url.startsWith('/api/rank/')) return rank.handle(req, res, url);
  if (url.startsWith('/api/cafeapp/')) return cafehost.handle(req, res, url);
  if (req.method === 'GET') return serveStatic(req, res);
  json(res, 405, { error: '허용되지 않은 요청입니다.' });
});
server.on('error', e => { console.error(e.code === 'EADDRINUSE' ? 'ERROR: port ' + PORT + ' is already used.' : (e.stack || e.message)); process.exitCode = 1; });
server.listen(PORT, '127.0.0.1', () => {
  console.log('키친앤코 블로그 스튜디오: ' + ORIGIN);
  // 인스타 토큰: 켜져 있는 동안 25일이 지나면 알아서 연장 (시작 20초 뒤, 그다음 12시간마다 확인)
  const tick = () => igapi.autoRefresh().catch(() => {});
  setTimeout(tick, 20000).unref(); setInterval(tick, 12 * 3600e3).unref();
});
