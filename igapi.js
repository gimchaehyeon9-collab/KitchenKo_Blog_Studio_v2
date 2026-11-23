// 키친앤코 스튜디오 — 인스타 게시 토큰 보관 + 인스타 API 대리 호출 (2.10.39)
//
// 왜 필요한가: 예약 게시 작업(Claude 예약 작업)은 내 PC의 Claude 앱 내장 브라우저에서 인스타 API 를 불러요.
//   예전에는 토큰을 그 브라우저의 저장소(localStorage)에 넣어 뒀는데, 그 저장소가 가끔 통째로 지워져서 게시가 실패했어요.
//   이제 토큰은 이 PC 의 스튜디오 설정 폴더(~/.kitchenko-studio/ig-token.json, 나만 읽기)에만 있고,
//   예약 작업은 http://127.0.0.1:<포트>/ig-runner.html 페이지의 kkIg.call(...) 로 부르면 스튜디오가 토큰을 붙여서 대신 호출해요.
//   → 토큰 값은 브라우저 저장소에도, 구글 드라이브에도, 예약 작업(AI)의 눈에도 나오지 않아요.
//
// 지키는 것
//   · 127.0.0.1 에서, 같은 프로그램 화면/러너 페이지(헤더 X-KK-Insta: 1)에서 온 요청만 받아요. 다른 웹사이트가 부를 수 없어요.
//   · 인스타 API 주소(graph.instagram.com)와 허용한 경로(내 계정·미디어·게시·댓글)만 대신 불러요. 토큰은 응답에서도 지워요.
//   · 토큰은 어떤 응답에도 담지 않아요 (저장 여부·계정 이름·길이만).
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const https = require('node:https');
const http = require('node:http');
const crypto = require('node:crypto');

const KEY_DIR = path.join(os.homedir(), '.kitchenko-studio');
const TOKEN_FILE = path.join(KEY_DIR, 'ig-token.json');
const BASE = process.env.KK_IG_GRAPH_BASE || 'https://graph.instagram.com';   // 시험할 때만 가짜 서버로 바꿔요
const VER = 'v25.0';
const MEDIA_HOSTS = /(^|\.)(cdninstagram\.com|fbcdn\.net|instagram\.com|fbsbx\.com)$/i;
const TEST_MEDIA_HOST = process.env.KK_IG_TEST_MEDIA_HOST || '';             // 시험 전용 (비어 있으면 쓰지 않음)
// 허용 경로: /me · /<숫자 id> · /<숫자 id>/<media|media_publish|comments|replies|children|content_publishing_limit>
const PATH_OK = /^\/(?:v\d+\.\d+\/)?(?:me|\d{5,25})(?:\/(?:media|media_publish|comments|replies|children|content_publishing_limit))?$/;
const RESERVED = new Set(['access_token', 'method']);

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
async function readJson(req, cap) {
  const chunks = []; let n = 0;
  for await (const ch of req) { n += ch.length; if (n > cap) throw Error('전송 용량이 너무 큽니다.'); chunks.push(ch); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

/* ───── 토큰 보관 ───── */
function readTok() { try { const j = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')); return j && typeof j.token === 'string' && j.token ? j : null; } catch (_) { return null; } }
function saveTok(o) {
  fs.mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 });
  const tmp = TOKEN_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(o, null, 1), { mode: 0o600 });
  fs.renameSync(tmp, TOKEN_FILE);
}
const cleanTok = s => String(s || '').trim().replace(/^["']|["']$/g, '').replace(/\s+/g, '');
const DAY = 86400e3, LIFE_DAYS = 60, AUTO_AFTER_DAYS = 25;
const SEEN = { last: null, runnerAt: 0 };          // 메모리에만: 마지막으로 예약 작업(러너)이 부른 시각 / 마지막 대리 호출 결과

/* ───── 인스타 API 호출 (이 PC 에서 직접) ───── */
function request(method, pathname, form, token, query, mask = true) {
  return new Promise(resolve => {
    const u = new URL(BASE); const lib = u.protocol === 'http:' ? http : https;
    const body = form ? new URLSearchParams(form).toString() : '';
    const qs = query ? '?' + new URLSearchParams(query).toString() : '';
    const req = lib.request({
      hostname: u.hostname, port: u.port || (u.protocol === 'http:' ? 80 : 443), path: pathname + qs, method, timeout: 30000,
      headers: form ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } : {},
    }, res => {
      const chunks = []; let n = 0;
      res.on('data', c => { n += c.length; if (n < 2e6) chunks.push(c); });
      res.on('end', () => {
        let text = Buffer.concat(chunks).toString('utf8');
        if (token && mask) text = text.split(token).join('●●●');     // 어떤 경우에도 토큰은 응답에 남기지 않는다 (연장 응답만 예외 — 새 토큰을 저장해야 해서 이 함수 안에서만 쓰고 밖으로 내보내지 않는다)
        let data; try { data = JSON.parse(text); } catch (_) { data = { error: { message: '인스타 응답을 읽지 못했어요 (' + res.statusCode + ')' } }; }
        resolve({ status: res.statusCode, data });
      });
    });
    req.on('timeout', () => req.destroy(Error('시간 초과 (30초)')));
    req.on('error', e => resolve({ status: 0, data: { error: { message: '인스타에 연결하지 못했어요: ' + e.message } } }));
    req.end(body || undefined);
  });
}
/** 토큰이 쓸 수 있는지 /me 로 확인 → { ok, username, userId } 또는 { ok:false, error } */
async function checkToken(token) {
  const r = await request('POST', '/' + VER + '/me', { method: 'get', fields: 'username,user_id', access_token: token }, token);
  if (r.data && r.data.username) return { ok: true, username: String(r.data.username), userId: String(r.data.user_id || r.data.id || '') };
  const msg = r.data && r.data.error && r.data.error.message ? String(r.data.error.message) : '알 수 없는 오류';
  return { ok: false, error: msg.slice(0, 160), code: r.data && r.data.error && r.data.error.code };
}

/** 저장된 토큰을 인스타에 연장 요청 → 새 토큰으로 바꿔 저장. 돌려주는 값 { ok, username, days } 또는 { ok:false, error } */
async function doRefresh() {
  const t = readTok(); if (!t) return { ok: false, error: '저장된 토큰이 없어요. 먼저 토큰을 저장해 주세요.' };
  const r = await request('GET', '/refresh_access_token', null, t.token, { grant_type: 'ig_refresh_token', access_token: t.token }, false);   // 연장 응답에는 새(또는 같은) 토큰이 들어 있어서 가리지 않는다
  const d = r.data || {};
  if (!d.access_token) return { ok: false, error: '연장하지 못했어요 — ' + String(d.error && d.error.message || '알 수 없는 오류').split(t.token).join('●●●').slice(0, 160) + ' (발급한 지 24시간이 안 됐거나 이미 만료됐을 수 있어요. 새로 만들어 저장해 주세요.)' };
  const fresh = cleanTok(d.access_token), c = await checkToken(fresh);
  if (!c.ok) return { ok: false, error: '연장된 토큰을 확인하지 못했어요 — ' + c.error };
  const now = Date.now(), life = d.expires_in ? d.expires_in * 1000 : LIFE_DAYS * DAY;
  saveTok({ token: fresh, username: c.username, userId: c.userId, savedAt: t.savedAt || now, refreshedAt: now, expiresAt: now + life });
  return { ok: true, username: c.username, days: Math.round(life / DAY) };
}
/** 스튜디오가 켜져 있는 동안 25일이 지났으면 알아서 연장한다 (60일짜리 토큰이라 한 달에 한 번이면 충분). 돌려주는 값: 연장했으면 결과, 아니면 null */
async function autoRefresh(now = Date.now()) {
  const t = readTok(); if (!t) return null;
  const since = t.refreshedAt || t.savedAt || now;
  if (now - since < AUTO_AFTER_DAYS * DAY) return null;
  if (t.expiresAt && now > t.expiresAt) return null;                       // 이미 만료됐으면 연장할 수 없어요 → 새로 만들어야 함
  const r = await doRefresh();
  if (r.ok) console.log('인스타 토큰을 자동으로 연장했어요 (' + r.days + '일)'); else console.log('인스타 토큰 자동 연장 실패: ' + r.error);
  return r;
}

/* ───── 요청 지키기 ───── */
function guard(req) {
  if (req.headers['x-kk-insta'] !== '1') return '허용되지 않은 요청이에요.';
  const host = String(req.headers.host || '');
  if (!/^127\.0\.0\.1:\d{2,5}$/.test(host)) return '이 PC 에서만 쓸 수 있어요.';                   // 이름 바꿔치기(DNS rebinding) 막기
  if (req.headers.origin && req.headers.origin !== 'http://' + host) return '이 PC 의 스튜디오 화면에서만 쓸 수 있어요.';
  return '';
}

function normPath(p) {
  const s = String(p || '');
  if (!PATH_OK.test(s)) throw Error('허용하지 않는 경로예요: ' + s.slice(0, 60));
  return /^\/v\d+\.\d+\//.test(s) ? s : '/' + VER + s;
}
function cleanParams(o) {
  const out = {}; let size = 0;
  for (const [k, v] of Object.entries(o && typeof o === 'object' ? o : {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(k) || RESERVED.has(k)) throw Error('허용하지 않는 항목이에요: ' + k.slice(0, 30));
    if (v == null) continue;
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    size += s.length; if (size > 60000) throw Error('보내는 내용이 너무 커요.');
    out[k] = s;
  }
  return out;
}

function sha256Of(urlStr) {
  return new Promise((resolve, reject) => {
    let u; try { u = new URL(urlStr); } catch (_) { return reject(Error('주소가 올바르지 않아요.')); }
    const test = TEST_MEDIA_HOST && u.host === TEST_MEDIA_HOST;
    if (!test && (u.protocol !== 'https:' || !MEDIA_HOSTS.test(u.hostname))) return reject(Error('인스타 사진 주소만 확인할 수 있어요.'));
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.get(u, { timeout: 30000 }, res => {
      if (res.statusCode !== 200) { res.resume(); return reject(Error('사진을 받지 못했어요 (' + res.statusCode + ')')); }
      const h = crypto.createHash('sha256'); let n = 0;
      res.on('data', c => { n += c.length; if (n > 30e6) { req.destroy(Error('사진이 너무 커요.')); } else h.update(c); });
      res.on('end', () => resolve({ sha256: h.digest('hex'), bytes: n }));
    });
    req.on('timeout', () => req.destroy(Error('시간 초과')));
    req.on('error', reject);
  });
}

async function handle(req, res, url) {
  const p = new URL(url, 'http://127.0.0.1').pathname;
  try {
    const bad = guard(req); if (bad) return json(res, 403, { ok: false, error: bad });

    if (p === '/api/ig/token' && req.method === 'GET') {
      if (req.headers['x-kk-who'] === 'runner') SEEN.runnerAt = Date.now();
      const t = readTok(), since = t ? (t.refreshedAt || t.savedAt || 0) : 0;
      return json(res, 200, { ok: true, has: !!t, username: t ? t.username || '' : '', savedAt: t ? t.savedAt || 0 : 0, refreshedAt: t ? t.refreshedAt || 0 : 0,
        expiresAt: t ? (t.expiresAt || (since ? since + LIFE_DAYS * DAY : 0)) : 0, expiresKnown: !!(t && t.expiresAt), len: t ? t.token.length : 0,
        last: SEEN.last, runnerAt: SEEN.runnerAt, version: '2.10.39' });
    }
    if (p === '/api/ig/token' && req.method === 'POST') {
      const b = await readJson(req, 8192), token = cleanTok(b.token);
      if (token.length < 40 || /[^A-Za-z0-9_\-.]/.test(token)) return json(res, 200, { ok: false, error: '토큰 모양이 아니에요. 새로 만든 토큰 전체를 붙여넣었는지 확인해 주세요.' });
      const c = await checkToken(token);
      if (!c.ok) return json(res, 200, { ok: false, error: '이 토큰은 쓸 수 없어요 — ' + c.error });
      saveTok({ token, username: c.username, userId: c.userId, savedAt: Date.now() });
      return json(res, 200, { ok: true, username: c.username, len: token.length });
    }
    if (p === '/api/ig/token/refresh' && req.method === 'POST') return json(res, 200, await doRefresh());
    if (p === '/api/ig/graph' && req.method === 'POST') {
      const t = readTok();
      if (!t) return json(res, 200, { ok: false, noToken: true, error: '스튜디오에 인스타 토큰이 저장돼 있지 않아요. 스튜디오 [인스타] 탭 → 연결 설정 → 인스타 게시 토큰에 붙여넣고 [토큰 저장]해 주세요.' });
      const b = await readJson(req, 80000);
      const pathname = normPath(b.path), isGet = String(b.method || 'POST').toUpperCase() === 'GET';
      const form = { ...cleanParams(b.params), access_token: t.token }; if (isGet) form.method = 'get';
      const r = await request('POST', pathname, form, t.token);
      SEEN.last = { at: Date.now(), path: pathname.replace(/^\/v\d+\.\d+/, '').replace(/\d{5,25}/g, '#'), ok: !(r.data && r.data.error), status: r.status, who: req.headers['x-kk-who'] === 'runner' ? 'runner' : 'studio' };
      return json(res, 200, { ok: true, status: r.status, data: r.data });
    }
    if (p === '/api/ig/hash' && req.method === 'POST') {
      const b = await readJson(req, 8192);
      return json(res, 200, { ok: true, ...(await sha256Of(String(b.url || ''))) });
    }
    json(res, 404, { ok: false, error: '없는 기능이에요.' });
  } catch (e) { json(res, 200, { ok: false, error: e.message || '요청 실패' }); }
}

module.exports = { handle, autoRefresh, _test: { PATH_OK, normPath, cleanParams, guard, TOKEN_FILE, readTok, saveTok } };
