// 글에 들어가는 고정 정보(대표번호·홈페이지 견적문의 주소). 화면에서 고친다.
const fs = require('fs');
const path = require('path');
const { DATA_DIR, PHONE } = require('./config');

const FILE = path.join(DATA_DIR, 'settings.json');

const DEFAULTS = {
  phone: PHONE, // 대표번호
  homepage: '', // 홈페이지 견적문의 주소. 비워 두면 글에 넣지 않는다.
  ai: 'claude', // 글을 쓰는 AI — 'claude'(기본) | 'codex'. 화면 설정 탭에서 바꾼다.
  stamp: true, // 본문 사진에 레몬하우스 각인(로고)을 넣어 올린다 (원본은 그대로)
  autoVideo: true, // 영상을 안 올렸으면 사진들로 영상을 자동으로 만들어 올린다
  proxy: '', // VPN·프록시 주소 (예: socks5://127.0.0.1:1080). 비우면 쓰지 않는다
};

/** 프록시 주소 정리: 앞뒤 공백 제거, 방식(http://, socks5:// 등)이 없으면 http:// 를 붙인다. 잘못된 값은 오류. */
function normalizeProxy(v) {
  const t = String(v || '').trim();
  if (!t) return '';
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : 'http://' + t;
  let u;
  try {
    u = new URL(withScheme);
  } catch {
    throw new Error('프록시 주소를 확인해 주세요. 예) socks5://127.0.0.1:1080 또는 127.0.0.1:8080');
  }
  if (!['http:', 'https:', 'socks4:', 'socks5:'].includes(u.protocol) || !u.hostname || !u.port) {
    throw new Error('프록시 주소는 주소와 포트가 모두 필요합니다. 예) socks5://127.0.0.1:1080 또는 127.0.0.1:8080');
  }
  if (u.username || u.password) throw new Error('아이디·비밀번호가 필요한 프록시는 아직 지원하지 않습니다. (VPN 프로그램을 켜 두는 방식을 써 주세요)');
  return `${u.protocol}//${u.host}`;
}

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(patch) {
  const next = { ...load() };
  if (typeof patch.phone === 'string') next.phone = patch.phone.trim() || DEFAULTS.phone;
  if (typeof patch.homepage === 'string') next.homepage = patch.homepage.trim();
  if (patch.ai === 'claude' || patch.ai === 'codex') next.ai = patch.ai;
  if (typeof patch.stamp === 'boolean') next.stamp = patch.stamp;
  if (typeof patch.autoVideo === 'boolean') next.autoVideo = patch.autoVideo;
  if (typeof patch.proxy === 'string') next.proxy = normalizeProxy(patch.proxy);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

module.exports = { load, save, normalizeProxy };
