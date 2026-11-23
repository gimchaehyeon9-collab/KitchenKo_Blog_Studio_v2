// 레몬하우스 각인(로고) 넣기 — 카페에 올라가는 본문 사진 맨 마지막 단계에서 한다.
//
// 🚨 원본 파일은 건드리지 않는다. 각인을 넣은 사본을 <사진폴더>/_stamped/ 에 만들고, 카페에는 그 사본을 올린다.
//    (표지에는 이미 로고가 들어 있으므로 표지에는 넣지 않는다.)
// 로고: lib/lemon-stamp.png (흰색 글자, 투명 배경). 사진 가로의 약 절반, 아래쪽 가운데, 반투명(약 40%).
//  (공사전 사진 샘플에서 크기·위치·투명도를 재서 맞춘 값이다.)
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const LOGO_FILE = path.join(__dirname, 'lemon-stamp.png');
// 사진 크기에 맞춘 비율 (가로 기준). opacity = 로고 불투명도(1=그대로, 0.4=약 40%).
const LOGO = { width: 0.507, bottom: 0.018, opacity: 0.4, shadow: 0 };
// 모양을 바꿀 때마다 올린다 — 이전 모양으로 만들어 둔 사본·자동 영상을 다시 만들게 하는 표식.
const REV = 'r2';

let logoRaw = null; // 원본 로고(RGBA) — 한 번만 읽는다
async function readLogo() {
  if (!logoRaw) logoRaw = await sharp(LOGO_FILE).ensureAlpha().png().toBuffer();
  return logoRaw;
}

/** 각인 사본을 두는 폴더. 원본과 섞이지 않게 밑줄로 시작한다. */
const stampDir = (photoDir) => path.join(photoDir, '_stamped_' + REV);

/**
 * 한 장에 각인을 넣어 dst(.jpg)로 저장한다.
 * 사진의 회전 정보(EXIF)를 반영해 똑바로 세운 뒤 로고를 얹는다. 사진 크기는 그대로, 화질은 높게(95).
 */
async function stampFile(src, dst) {
  const { data, info } = await sharp(src, { failOn: 'none' }).rotate().toColourspace('srgb').toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const logo = await readLogo();
  const lw = Math.max(40, Math.round(W * LOGO.width));
  let sized = await sharp(logo).resize({ width: lw }).png().toBuffer();
  const lh = (await sharp(sized).metadata()).height;
  if (LOGO.opacity < 1) {
    // 글자 모양(알파)에만 불투명도를 곱한다 — 색은 그대로 흰색
    sized = await sharp(sized).ensureAlpha().linear([1, 1, 1, LOGO.opacity], [0, 0, 0, 0]).png().toBuffer();
  }
  const left = Math.max(0, Math.min(W - lw, Math.round((W - lw) / 2))); // 가로 가운데
  const top = Math.max(0, Math.min(H - lh, Math.round(H - W * LOGO.bottom - lh)));
  const layers = [];
  if (LOGO.shadow > 0) {
    // 흰 벽 위에서도 읽히도록 아주 옅은 그림자 (로고 모양을 검게 칠해 흐리게)
    const alpha = await sharp(sized).extractChannel('alpha').toBuffer();
    const black = await sharp({ create: { width: lw, height: lh, channels: 3, background: '#000000' } })
      .joinChannel(alpha)
      .png()
      .toBuffer();
    const blur = Math.max(0.6, lw * 0.012);
    const soft = await sharp(black).blur(blur).linear([1, 1, 1, LOGO.shadow], [0, 0, 0, 0]).png().toBuffer();
    layers.push({ input: soft, left, top: Math.min(H - lh, top + Math.max(1, Math.round(lw * 0.006))) });
  }
  layers.push({ input: sized, left, top });
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  await sharp(data).composite(layers).jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).toFile(dst);
}

/**
 * photoDir 안의 사진 한 장(name)의 각인 사본 경로를 돌려준다. srcFile 을 주면(보정본) 그 파일에 각인을 넣는다. 이미 만들어 둔 것이 원본보다 새것이면 다시 만들지 않는다.
 */
async function ensure(photoDir, name, srcFile) {
  const orig = path.join(photoDir, name);
  const src = srcFile || orig;
  // 보정본(수직·수평/밝기/모자이크)에 각인을 넣을 때는 원본 사본과 섞이지 않게 이름을 달리한다
  const tag = path.resolve(src) === path.resolve(orig) ? '' : '.fx';
  const dst = path.join(stampDir(photoDir), name.replace(/\.[^.]+$/, '') + tag + '.jpg');
  try {
    if (fs.statSync(dst).mtimeMs >= fs.statSync(src).mtimeMs && fs.statSync(dst).mtimeMs >= fs.statSync(LOGO_FILE).mtimeMs) return dst;
  } catch {
    /* 없으면 만든다 */
  }
  await stampFile(src, dst);
  return dst;
}

module.exports = { ensure, stampFile, stampDir, LOGO, REV };
