/* 블로그에 쓴 사진들을 이어 붙인 간단한 영상(슬라이드쇼) 만들기 — 브라우저에서 바로 만들어요 (기능 없음: 사진만 차례로) */
(() => {
'use strict';
const KK = window.KK;
const load = src => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(Error('사진을 열 수 없어요.')); im.src = src; });

KK.makeSlideshow = async onProgress => {
  const s = KK.state, ids = [];
  for (const c of s.cards) for (const id of c.photoIds) if (!ids.includes(id)) ids.push(id);
  const photos = ids.map(id => KK.photos.get(id)).filter(Boolean);
  if (!photos.length) throw Error('영상에 쓸 사진이 없어요.');
  if (typeof MediaRecorder === 'undefined') throw Error('이 브라우저에서는 영상을 만들 수 없어요. 크롬을 사용해 주세요.');
  const W = 1280, H = 720, SEC = KK.SLIDE_SEC || 2.2, FADE = Math.min(.5, SEC / 3);
  // 사진마다 미리 한 장씩 그려 둠: 같은 사진을 흐리게 깔고 가운데에 사진 전체가 보이게
  const slides = [];
  for (const p of photos) {
    const img = await load(await KK.photoData(p)), c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    const k = Math.max(W / img.width, H / img.height) * 1.2;
    g.filter = 'blur(30px) brightness(.75)'; g.drawImage(img, (W - img.width * k) / 2, (H - img.height * k) / 2, img.width * k, img.height * k); g.filter = 'none';
    const f = Math.min(W / img.width, H / img.height);
    g.drawImage(img, (W - img.width * f) / 2, (H - img.height * f) / 2, img.width * f, img.height * f);
    slides.push(c);
  }
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const ctx = cv.getContext('2d');
  const mime = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t)) || '';
  const rec = new MediaRecorder(cv.captureStream(30), mime ? { mimeType: mime, videoBitsPerSecond: 4e6 } : undefined);
  const chunks = []; rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  const done = new Promise(res => { rec.onstop = res; });
  const total = slides.length * SEC;
  ctx.drawImage(slides[0], 0, 0); rec.start(500);
  const t0 = performance.now();
  await new Promise(resolve => {
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      if (t >= total) return resolve();
      const i = Math.min(slides.length - 1, Math.floor(t / SEC)), fr = t - i * SEC;
      ctx.globalAlpha = 1; ctx.drawImage(slides[i], 0, 0);
      if (fr > SEC - FADE && i + 1 < slides.length) { ctx.globalAlpha = (fr - (SEC - FADE)) / FADE; ctx.drawImage(slides[i + 1], 0, 0); ctx.globalAlpha = 1; }
      if (onProgress) onProgress(Math.round(t), Math.round(total));
      setTimeout(tick, 33);
    };
    tick();
  });
  ctx.globalAlpha = 1; ctx.drawImage(slides[slides.length - 1], 0, 0);
  await new Promise(r => setTimeout(r, 300)); rec.stop(); await done;
  const type = (rec.mimeType || mime || 'video/webm').split(';')[0], ext = /mp4/.test(type) ? 'mp4' : 'webm';
  const blob = new Blob(chunks, { type });
  if (blob.size < 2000) throw Error('영상이 만들어지지 않았어요.');
  return new File([blob], '키친앤코_사진영상.' + ext, { type });
};
})();
