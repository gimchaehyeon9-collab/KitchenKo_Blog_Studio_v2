// 영상용 사진을 저장할 폴더를 정해요 (키친앤코 · 레몬하우스, 인스타 · 블로그 모두 같은 규칙)
//   D:\김채현 키친앤코 \ 26.11 \ 11.3 \ 26.06.15. 부산광역시 … (최연종) \ 사진들
//   (기준 폴더) \ 월 폴더 \ 날짜 폴더 \ 현장 폴더
// 월·날짜 폴더가 이미 있으면(26.11, 11.03, 11월 3일 …처럼 조금 달라도) 그 폴더를 찾아 쓰고, 없을 때만 새로 만들어요.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch (_) { return false; } };
const subDirs = p => { try { return fs.readdirSync(p, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); } catch (_) { return []; } };

// 기준 폴더: Windows에서는 사장님 폴더(D:\김채현 키친앤코). 그 드라이브가 없거나 다른 컴퓨터면 다운로드 폴더 안에 같은 모양으로 만들어요.
const DEFAULT_ROOT = process.platform === 'win32' ? 'D:\\김채현 키친앤코' : path.join(os.homedir(), 'Downloads', '키친앤코 영상용 사진');
const FALLBACK_ROOT = path.join(os.homedir(), 'Downloads', '키친앤코 영상용 사진');
// 예전 버전의 기본 저장 위치 — 이 값으로 남아 있으면 새 기본 폴더로 바꿔서 써요
const OLD_DEFAULTS = [
  path.join(os.homedir(), 'Downloads', '키친앤코 영상용 사진'),
  path.join(os.homedir(), 'Downloads', '레몬하우스 블로그 사진')
].map(p => p.toLowerCase());
const migrate = v => (!v || OLD_DEFAULTS.includes(String(v).toLowerCase())) ? DEFAULT_ROOT : v;

const clean = (n, max) => String(n || '').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, max || 120).trim();

// 오늘 날짜 폴더(월 폴더 안)를 찾거나 만들어요. now는 시험용으로 바꿀 수 있어요.
function dayDir(root, now = new Date()) {
  const yy = String(now.getFullYear() % 100).padStart(2, '0'), mo = now.getMonth() + 1, d = now.getDate();
  const monthName = yy + '.' + String(mo).padStart(2, '0'), dayName = mo + '.' + d;
  const mRe = new RegExp('^' + yy + '\\s*\\.\\s*0?' + mo + '\\s*월?$');
  const dRe = new RegExp('^0?' + mo + '\\s*[.\\-_월]\\s*0?' + d + '(?!\\d)');
  const pick = (names, re, exact) => names.includes(exact) ? exact : names.sort().find(n => re.test(n));
  const mDir = path.join(root, pick(subDirs(root), mRe, monthName) || monthName);
  const dDir = path.join(mDir, pick(subDirs(mDir), dRe, dayName) || dayName);
  fs.mkdirSync(dDir, { recursive: true });
  return dDir;
}

// 현장 폴더까지 만들어서 돌려줘요. { dir, root, fallback }
function videoFolder(root, siteName, now = new Date()) {
  let base = migrate(root), fallback = false;
  if (!isDir(base)) {
    // 기준 폴더가 없으면(예: D 드라이브가 없는 컴퓨터) 다운로드 폴더에 같은 모양으로 만들어요
    try { fs.mkdirSync(base, { recursive: true }); } catch (_) { base = FALLBACK_ROOT; fallback = true; }
    if (!isDir(base)) { base = FALLBACK_ROOT; fallback = true; }
  }
  const site = clean(siteName, 120) || '현장';
  const dir = path.join(dayDir(base, now), site);
  fs.mkdirSync(dir, { recursive: true });
  return { dir, root: base, fallback };
}

module.exports = { videoFolder, dayDir, migrate, DEFAULT_ROOT, _clean: clean };
