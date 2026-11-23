// 키친앤코 스튜디오 — 레몬하우스 [카페 공사전·중] 탭 (2.10.30)
// 별도 프로그램인 "카페 공사중 자동 발행"(cafe-construction-poster, 포트 4174)을 Studio가 같이 켜 주고,
// 레몬하우스 탭 안에 그 화면을 넣어 보여 줘요. 그 프로그램의 설정·카페 로그인·말투 자료·작업 기록은 원래 폴더에 그대로 있고
// Studio는 읽거나 고치지 않아요. (여기서 하는 일: 폴더 확인 → 꺼져 있으면 `node server.js` 실행 → 켜졌는지 확인)
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');

const KEY_DIR = path.join(os.homedir(), '.kitchenko-studio');
const SET_FILE = path.join(KEY_DIR, 'cafe-app.json');
const LOG_FILE = path.join(KEY_DIR, 'cafe-app.log');
const APP_NAME = 'cafe-construction-poster';
const DEFAULT_PORT = 4174;

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
async function readJson(req, cap) {
  const chunks = []; let n = 0;
  for await (const ch of req) { n += ch.length; if (n > cap) throw Error('전송 용량이 너무 큽니다.'); chunks.push(ch); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
const defaultDir = () => path.join(os.homedir(), 'Documents', APP_NAME);
function readRaw() { try { return JSON.parse(fs.readFileSync(SET_FILE, 'utf8')); } catch (_) { return {}; } }
function readSettings() {
  const raw = readRaw(), port = Number(process.env.KK_CAFE_PORT || raw.port) || DEFAULT_PORT;
  return { dir: String(raw.dir || defaultDir()), port: port > 0 && port < 65536 ? port : DEFAULT_PORT };
}

// 폴더가 카페 프로그램 폴더가 맞는지 (server.js · package.json 이름 · 설치된 express)
function checkDir(dir) {
  try {
    if (!dir || !fs.statSync(dir).isDirectory()) return '폴더를 찾지 못했어요: ' + dir;
  } catch (_) { return '폴더를 찾지 못했어요: ' + dir; }
  let pkg = null;
  try { pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8').replace(/^﻿/, '')); } catch (_) {}
  if (!fs.existsSync(path.join(dir, 'server.js')) || !pkg || pkg.name !== APP_NAME) return '이 폴더는 카페 공사중 프로그램(' + APP_NAME + ') 폴더가 아니에요: ' + dir;
  if (!fs.existsSync(path.join(dir, 'node_modules', 'express'))) return '처음 한 번 설치가 필요해요. 그 폴더에서 [start-safe.bat]을 더블클릭하거나 명령 창에서 npm install 을 해 주세요.';
  return '';
}

// 카페 프로그램 화면이 열려 있는지 (포트에 답하는지)
function probe(port, timeout = 1500) {
  return new Promise(resolve => {
    const req = http.get({ host: '127.0.0.1', port, path: '/cafe.html', timeout }, res => { res.resume(); resolve(res.statusCode === 200); });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
function tailLog(n = 6) {
  try { return fs.readFileSync(LOG_FILE, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean).slice(-n).join('\n'); } catch (_) { return ''; }
}

// ── 카페 프로그램 업데이트 (이 폴더의 cafe-update/ 에 같이 들어 있는 바뀐 파일만 복사) ──
//   · 카페 프로그램을 켜기 직전에, 아직 적용 안 된 업데이트가 있으면 복사해요. 바뀌는 파일은 폴더 안 _업데이트전_백업 에 먼저 모아 둬요.
//   · 설정·로그인·작업 기록(cafe.config.json, auth, cafe/data)은 건드리지 않아요 — 목록에 있는 파일만 바꿔요.
const UPDATE_DIR = path.join(__dirname, 'cafe-update');
function readManifest() { try { const m = JSON.parse(fs.readFileSync(path.join(UPDATE_DIR, 'manifest.json'), 'utf8')); return m && m.version && Array.isArray(m.files) ? m : null; } catch (_) { return null; } }
function updateState(dir) {
  const m = readManifest(); if (!m) return { has: false };
  let cur = ''; try { cur = JSON.parse(fs.readFileSync(path.join(dir, '.studio-cafe-update.json'), 'utf8')).version || ''; } catch (_) {}
  return { has: true, version: m.version, applied: cur === m.version, current: cur };
}
function applyUpdate(dir) {
  const m = readManifest(), st = updateState(dir);
  if (!m || st.applied) return { applied: false, count: 0 };
  const root = path.resolve(dir), backup = path.join(root, '_업데이트전_백업', m.version.replace(/[^\w.-]/g, '_'));
  let n = 0;
  for (const rel of m.files) {
    if (typeof rel !== 'string' || !rel || path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) continue;
    const src = path.join(UPDATE_DIR, 'files', rel), dst = path.resolve(root, rel);
    if (!dst.startsWith(root + path.sep) || !fs.existsSync(src)) continue;
    if (fs.existsSync(dst)) { fs.mkdirSync(path.dirname(path.join(backup, rel)), { recursive: true }); fs.copyFileSync(dst, path.join(backup, rel)); }
    fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); n++;
  }
  fs.writeFileSync(path.join(root, '.studio-cafe-update.json'), JSON.stringify({ version: m.version, at: new Date().toISOString(), files: n }, null, 1), 'utf8');
  return { applied: true, count: n, version: m.version, backup };
}

let starting = null;
async function start() {
  if (starting) return starting;
  starting = (async () => {
    const st = readSettings();
    if (await probe(st.port)) return { ok: true, running: true, started: false, url: 'http://127.0.0.1:' + st.port };
    const bad = checkDir(st.dir);
    if (bad) throw Error(bad);
    try { applyUpdate(st.dir); } catch (e) { throw Error('카페 프로그램 업데이트 파일을 복사하지 못했어요: ' + e.message); }
    fs.mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 });
    const fd = fs.openSync(LOG_FILE, 'w');
    let exited = null;
    const child = spawn(process.execPath, ['server.js'], {
      cwd: st.dir, env: { ...process.env, PORT: String(st.port) }, detached: true, windowsHide: true, stdio: ['ignore', fd, fd]
    });
    child.on('exit', code => { exited = code == null ? -1 : code; });
    child.on('error', e => { exited = -2; try { fs.appendFileSync(LOG_FILE, '\n실행 오류: ' + e.message); } catch (_) {} });
    child.unref();
    try { fs.closeSync(fd); } catch (_) {}
    for (let i = 0; i < 50; i++) {                    // 최대 약 25초
      await sleep(500);
      if (await probe(st.port, 800)) return { ok: true, running: true, started: true, url: 'http://127.0.0.1:' + st.port };
      if (exited !== null) break;
    }
    const log = tailLog();
    throw Error('카페 프로그램이 켜지지 않았어요.' + (log ? '\n' + log : '') + '\n(그 폴더의 [start-safe.bat]을 직접 실행하면 이유가 보여요.)');
  })().finally(() => { starting = null; });
  return starting;
}

async function handle(req, res, url) {
  const p = url.split('?')[0];
  try {
    if (p === '/api/cafeapp/status') {
      const st = readSettings(), problem = checkDir(st.dir), running = await probe(st.port);
      return json(res, 200, { ok: true, dir: st.dir, port: st.port, url: 'http://127.0.0.1:' + st.port, dirOk: !problem, problem, running, starting: !!starting, update: problem ? { has: false } : updateState(st.dir) });
    }
    if (p === '/api/cafeapp/start' && req.method === 'POST') return json(res, 200, await start());
    if (p === '/api/cafeapp/settings' && req.method === 'POST') {
      const b = await readJson(req, 4096), cur = readRaw();
      if ('dir' in b) {
        const dir = String(b.dir || '').trim().replace(/^"|"$/g, '');
        if (!dir) delete cur.dir;                      // 비우면 기본 위치(문서\\cafe-construction-poster)
        else { const bad = checkDir(dir); if (bad && !/설치가 필요/.test(bad)) throw Error(bad); cur.dir = dir; }
      }
      fs.mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 });
      fs.writeFileSync(SET_FILE, JSON.stringify(cur, null, 1), { mode: 0o600 });
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { ok: false, error: '알 수 없는 요청이에요.' });
  } catch (e) { return json(res, 200, { ok: false, error: e.message || String(e) }); }
}

module.exports = { handle, _test: { checkDir, probe, start, readSettings, applyUpdate, updateState } };
