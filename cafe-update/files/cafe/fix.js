// 사진 보정 저장 — 수직·수평 / 밝기·색 / 모자이크.
//
// 원본은 그대로 두고 보정본을 photos/_fixed/ 에 따로 만든다. (원본 무가공 원칙)
// 보정값은 job.fix[파일명] = { rotate, vertical, horizontal, tone?, mosaic? } 로 저장하고,
// 카페 입력·표지·썸네일은 jobs.photoFile() 로 보정본을 쓴다.
// 계산은 public/straighten.js (수직·수평) + public/photoedit.js (밝기·색·모자이크) — 화면 미리보기와 같은 코드.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const St = require('../public/straighten');
const PE = require('../public/photoedit');
const jobs = require('./jobs');

const AUTO_EDGE = 1000; // 자동 계산용 축소 크기
const MID_EDGE = 1600; // 화면 보정 창에서 쓰는 중간 크기

const midFile = (id, name) => path.join(jobs.photoDir(id), '_mid', name.replace(/\.[^.]+$/, '') + '.jpg');
const thumbFile = (id, name) => path.join(jobs.photoDir(id), '_thumb', name.replace(/\.[^.]+$/, '') + '.jpg');

/** 보정 창용 중간 크기 원본 (회전 정보 반영). 한 번 만들면 다시 쓴다. */
async function mid(id, name) {
  const src = path.join(jobs.photoDir(id), name);
  if (!fs.existsSync(src)) return null;
  const out = midFile(id, name);
  if (!fs.existsSync(out)) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await sharp(src).rotate().resize({ width: MID_EDGE, height: MID_EDGE, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toFile(out);
  }
  return out;
}

/** 자동 보정값만 계산한다 (저장하지 않음). */
async function detect(id, name, mode = 'auto') {
  const src = path.join(jobs.photoDir(id), name);
  const { data, info } = await sharp(src).rotate().resize({ width: AUTO_EDGE, height: AUTO_EDGE, fit: 'inside', withoutEnlargement: true }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return St.detect(St.gray(data, info.width, info.height, 3), info.width, info.height, mode);
}

/**
 * 보정값을 원본 크기로 적용해 저장한다. 아무 보정도 없으면(회전·원근 0, 밝기·색 0, 모자이크 없음) 보정본을 지운다.
 * params: { rotate, vertical, horizontal, tone?, mosaic? }
 * 돌려주는 값: 저장된 보정값 { rotate, vertical, horizontal, tone?, mosaic? } 또는 null
 */
async function apply(id, name, params) {
  const src = path.join(jobs.photoDir(id), name);
  if (!fs.existsSync(src)) throw new Error(`사진을 찾지 못했습니다: ${name}`);
  const a = St.normalize(params);
  const tone = PE.normTone(params && params.tone);
  const mosaic = PE.normMosaic(params && params.mosaic);
  const keep = { ...a };
  if (PE.hasTone(tone)) keep.tone = tone;
  if (PE.hasMosaic(mosaic)) keep.mosaic = mosaic;
  const out = jobs.fixedFile(id, name);
  fs.rmSync(thumbFile(id, name), { force: true }); // 썸네일은 다시 만든다
  if (PE.isIdentity(keep)) {
    fs.rmSync(out, { force: true });
    return null;
  }
  const meta = await sharp(src).metadata();
  const { data, info } = await sharp(src).rotate().removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const dst = PE.process(data, info.width, info.height, 3, keep); // 모자이크 → 수직·수평 → 밝기·색
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await sharp(dst, { raw: { width: info.width, height: info.height, channels: 3 } })
    .withMetadata({ density: meta.density })
    .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
    .toFile(out);
  return keep;
}

module.exports = { mid, detect, apply };
