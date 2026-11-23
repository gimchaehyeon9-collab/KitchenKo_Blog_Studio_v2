// 네이버 부동산 도면 이미지를 내 PC 서버가 대신 받아 오는 부분 (네이버 이미지 서버 주소만 허용)
'use strict';
const HOSTS = new Set(['landthumb-phinf.pstatic.net', 'land-phinf.pstatic.net', 'dbscthumb-phinf.pstatic.net', 'img.land.naver.com']);
const MAX = 20 * 1024 * 1024;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

function mimeOf(b) {
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 12 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return '';
}
function checkUrl(raw) {
  let u; try { u = new URL(String(raw || '')); } catch (_) { throw Error('도면 이미지 주소가 올바르지 않아요.'); }
  if (u.protocol !== 'https:' || !HOSTS.has(u.hostname) || u.username || u.password || u.port) throw Error('지원하는 네이버 도면 이미지 주소가 아니에요. 도면 파일을 직접 첨부해 주세요.');
  u.searchParams.delete('type');   // type=w800 같은 축소 옵션을 빼서 원본 크기로
  return u;
}
async function fetchLandImage(raw, fetchImpl) {
  const u = checkUrl(raw), f = fetchImpl || fetch;
  const r = await f(u, { redirect: 'error', signal: AbortSignal.timeout(30000), headers: { 'user-agent': UA, referer: 'https://fin.land.naver.com/' } });
  if (!r.ok) throw Error('도면을 불러오지 못했어요 (' + r.status + '). 도면 파일을 직접 첨부해 주세요.');
  if (Number(r.headers.get('content-length') || 0) > MAX) throw Error('도면 파일이 너무 커요. 도면 파일을 직접 첨부해 주세요.');
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX) throw Error('도면 파일이 너무 커요. 도면 파일을 직접 첨부해 주세요.');
  const mime = mimeOf(buf); if (!mime) throw Error('도면 이미지 형식이 아니에요. 도면 파일을 직접 첨부해 주세요.');
  return { mime, bytes: buf.length, data: 'data:' + mime + ';base64,' + buf.toString('base64'), url: u.href };
}

// ── 카페 글 속 이미지 (공사범위 표 사진 등) — 네이버 이미지 서버(*.pstatic.net) 주소만 ──
const CAFE_HOST = /^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.pstatic\.net$/;
function checkCafeUrl(raw) {
  let u; try { u = new URL(String(raw || '')); } catch (_) { throw Error('카페 이미지 주소가 올바르지 않아요.'); }
  if (u.protocol !== 'https:' || !CAFE_HOST.test(u.hostname) || u.username || u.password || u.port) throw Error('네이버 이미지 서버 주소가 아니에요. 캡처 이미지로 직접 넣어 주세요.');
  u.searchParams.delete('type');   // type=w800 같은 축소 옵션을 빼서 원본 크기로
  return u;
}
async function fetchCafeImage(raw, fetchImpl) {
  const u = checkCafeUrl(raw), f = fetchImpl || fetch;
  const r = await f(u, { redirect: 'error', signal: AbortSignal.timeout(30000), headers: { 'user-agent': UA, referer: 'https://cafe.naver.com/' } });
  if (!r.ok) throw Error('카페 사진을 불러오지 못했어요 (' + r.status + '). 캡처 이미지로 직접 넣어 주세요.');
  if (Number(r.headers.get('content-length') || 0) > MAX) throw Error('카페 사진이 너무 커요. 캡처 이미지로 직접 넣어 주세요.');
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX) throw Error('카페 사진이 너무 커요. 캡처 이미지로 직접 넣어 주세요.');
  const mime = mimeOf(buf); if (!mime) throw Error('이미지 형식이 아니에요. 캡처 이미지로 직접 넣어 주세요.');
  return { mime, bytes: buf.length, data: 'data:' + mime + ';base64,' + buf.toString('base64'), url: u.href };
}
module.exports = { fetchLandImage, fetchCafeImage, checkUrl, checkCafeUrl, mimeOf, HOSTS };
