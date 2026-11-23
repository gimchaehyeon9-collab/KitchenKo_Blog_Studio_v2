// 빈 포트를 골라 서버를 켜고 브라우저를 엽니다. (Node.js 18+, 추가 설치 없음)
'use strict';
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const ROOT = __dirname;
const APP = 'kitchenko-blog-studio';
const VERSION = 3036;
const PORTS = Array.from({ length: 60 }, (_, i) => 4540 + i);
const PREF = path.join(ROOT, '.last-port.json');
const URL_FILE = path.join(ROOT, '.launch-url.txt');
const LOG = path.join(ROOT, 'launcher.log');
const DEBUG = process.argv.includes('--debug');
const NO_BROWSER = process.argv.includes('--from-vbs');

const trace = (...m) => { const line = '[' + new Date().toISOString() + '] ' + m.join(' ') + '\n'; fs.appendFileSync(LOG, line); if (DEBUG) process.stdout.write(line); };
const delay = ms => new Promise(r => setTimeout(r, ms));

function isFree(port) {
  return new Promise(resolve => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen({ host: '127.0.0.1', port, exclusive: true }, () => s.close(() => resolve(true)));
  });
}
function probe(port) {
  return new Promise(resolve => {
    const req = http.get({ hostname: '127.0.0.1', port, path: '/health', timeout: 500 }, res => {
      let s = ''; res.on('data', d => { s += d; });
      res.on('end', () => { try { const j = JSON.parse(s); resolve(j.app === APP && j.version === VERSION && j.root === ROOT); } catch (_) { resolve(false); } });
    });
    req.on('timeout', () => req.destroy()); req.on('error', () => resolve(false));
  });
}
// 예전 버전 스튜디오(같은 폴더)가 아직 켜져 있으면 끄고 같은 주소(포트)를 이어서 씁니다
// → 주소가 같아야 브라우저에 저장된 작성 중인 글·키워드 기록이 그대로 이어집니다
function healthOf(port) {
  return new Promise(resolve => {
    const req = http.get({ hostname: '127.0.0.1', port, path: '/health', timeout: 500 }, res => {
      let s = ''; res.on('data', d => { s += d; });
      res.on('end', () => { try { resolve(JSON.parse(s)); } catch (_) { resolve(null); } });
    });
    req.on('timeout', () => req.destroy()); req.on('error', () => resolve(null));
  });
}
async function stopOldStudio(port) {
  const j = await healthOf(port);
  if (!j || j.app !== APP || !(j.version < VERSION)) return false;   // 같은 프로그램의 더 예전 버전만
  if (process.platform !== 'win32') return false;
  try {
    const out = cp.execFileSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8', windowsHide: true });
    const line = out.split(/\r?\n/).find(l => new RegExp('127\\.0\\.0\\.1:' + port + '\\s.*LISTENING', 'i').test(l));
    const pid = line && Number(line.trim().split(/\s+/).pop());
    if (!pid || pid === process.pid) return false;
    cp.execFileSync('taskkill', ['/PID', String(pid), '/F'], { windowsHide: true, stdio: 'ignore' });
    trace('예전 버전 스튜디오 종료:', port, 'v' + j.version);
    for (let i = 0; i < 25; i++) { await delay(200); if (await isFree(port)) return true; }
  } catch (e) { trace('예전 버전 종료 실패:', e.message); }
  return false;
}
function openBrowser(port) {
  const url = `http://127.0.0.1:${port}/`;
  fs.writeFileSync(URL_FILE, url, 'utf8');
  trace('주소:', url);
  if (NO_BROWSER) return;
  const cmd = process.platform === 'win32' ? ['cmd.exe', ['/d', '/s', '/c', `start "" "${url}"`]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  const p = cp.spawn(cmd[0], cmd[1], { detached: true, windowsHide: true, stdio: 'ignore' });
  p.on('error', e => trace('브라우저 열기 실패:', e.message)); p.unref();
}
async function main() {
  if (!fs.existsSync(path.join(ROOT, 'server.js')) || !fs.existsSync(path.join(ROOT, 'public', 'index.html')))
    throw Error('프로그램 파일이 없습니다. ZIP을 전체 압축 해제한 뒤 실행하세요.');
  try { fs.unlinkSync(URL_FILE); } catch (_) {}
  let preferred = 4540;
  try { const j = JSON.parse(fs.readFileSync(PREF, 'utf8')); if (PORTS.includes(j.port)) preferred = j.port; } catch (_) {}
  const order = [preferred, ...PORTS.filter(p => p !== preferred)];
  for (const port of order) if (await probe(port)) { trace('이미 실행 중인 스튜디오 사용:', port); openBrowser(port); return; }
  await stopOldStudio(preferred);
  for (const port of order) {
    if (!await isFree(port)) continue;
    const log = fs.openSync(path.join(ROOT, 'server.log'), 'a');
    const child = cp.spawn(process.execPath, [path.join(ROOT, 'server.js')], {
      cwd: ROOT, env: { ...process.env, KEYCHEN_PORT: String(port) }, detached: true, windowsHide: true, stdio: ['ignore', log, log]
    });
    fs.closeSync(log); child.unref();
    for (let i = 0; i < 40; i++) {
      await delay(200);
      if (await probe(port)) { fs.writeFileSync(PREF, JSON.stringify({ port })); trace('실행 완료', port); openBrowser(port); return; }
      if (child.exitCode !== null) break;
    }
    trace('포트', port, '실행 실패, 다음 포트 시도');
  }
  throw Error('서버를 시작하지 못했습니다. server.log를 확인하세요.');
}
main().catch(e => { trace('오류:', e.message); process.exitCode = 1; });
