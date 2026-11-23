/* 크롬 확장 연결 + 네이버 글쓰기 자동 입력 */
(() => {
'use strict';
const KK = window.KK;
const { $ } = KK;

/* 페이지 ↔ 확장(local-bridge.js) 메시지 */
KK.ext = (action, payload = {}, timeout = 15000) => new Promise((resolve, reject) => {
  const id = 'kk-' + Math.random().toString(36).slice(2, 12);
  const timer = setTimeout(() => { window.removeEventListener('message', on); reject(Error('확장 프로그램 응답이 없어요. 크롬에 키친앤코 확장 프로그램이 설치·사용 설정되어 있는지 확인하고, 이 탭을 새로고침해 주세요.')); }, timeout);
  function on(e) {
    if (e.source !== window || e.origin !== location.origin) return;
    const m = e.data; if (!m || m.source !== 'KK_EXT' || m.id !== id) return;
    clearTimeout(timer); window.removeEventListener('message', on); resolve(m.answer || { ok: false, error: '빈 응답' });
  }
  window.addEventListener('message', on);
  window.postMessage({ source: 'KK_PAGE', id, action, payload }, location.origin);
});

function status(msg, kind = '') { const el = $('naverStatus'); el.textContent = msg; el.className = 'status ' + kind; }

KK.checkExtension = async () => {
  try {
    const r = await KK.ext('PING', {}, 2500);
    if (r.ok) KK.extVersion = r.version;
    $('extState').textContent = r.ok ? '확장 연결됨 v' + r.version : '확장 오류';
    $('extState').className = 'pill ' + (r.ok ? 'ok' : 'bad');
    return r.ok;
  } catch (_) { $('extState').textContent = '확장 미설치'; $('extState').className = 'pill bad'; return false; }
};

/* 업로드 순서 = 실제 블로그 템플릿 순서 */

setTimeout(() => { try { const d = $('optSchedDate'); if (d && !d.value) { const t = new Date(Date.now() + 86400000); d.value = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); $('optSchedH').value = '09'; $('optSchedM').value = '00'; } } catch (_) {} }, 0);
function readSched() {
  const on = $('optSched') && $('optSched').checked; if (!on) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec($('optSchedDate').value || ''); if (!m) throw Error('예약 날짜를 골라 주세요.');
  const h = +$('optSchedH').value, mi = +$('optSchedM').value;
  if (new Date(+m[1], +m[2] - 1, +m[3], h, mi) <= new Date()) throw Error('예약 시간이 이미 지났어요. 앞으로의 시간을 골라 주세요.');
  return { y: +m[1], m: +m[2], d: +m[3], h, mi };
}
const verGte = (v, min) => { const a = String(v || '0').split('.').map(Number), b = min.split('.').map(Number); for (let i = 0; i < 3; i++) { if ((a[i] || 0) !== b[i]) return (a[i] || 0) > b[i]; } return true; };
/* 레몬하우스는 문단을 자동으로 채우지 않으므로, 비어 있는 사진이 있으면 보내기 전에 알려 줍니다 */
function checkLemonTexts() {
  if (KK.brandKey !== 'lemon') return;
  const empty = KK.state.cards.map((c, i) => c.text.trim() ? 0 : i + 1).filter(Boolean);
  if (empty.length) { if (KK.goStep) KK.goStep(3); throw Error('설명 글이 비어 있는 사진이 있어요 (' + empty.join(', ') + '번). [글 쓰기] 단계에서 [Claude로 자동 작성]을 하거나 직접 적어 주세요.'); }
}
async function buildPlan() {
  const s = KK.state, doc = KK.compose(s);
  if (!s.cards.length) throw Error('본문 사진을 1장 이상 올려 주세요.');
  const lemon = KK.brandKey === 'lemon';
  checkLemonTexts();
  // 레몬하우스: 내 블로그 서식으로 정리 (확장 프로그램 2.10.1 이상 필요)
  let lemonStyle = lemon && $('optLStyle') && $('optLStyle').checked && !!KK.lemonRestyle;
  if (lemonStyle && !verGte(KK.extVersion, '2.10.1')) { lemonStyle = false; KK.toast('크롬 확장 프로그램이 옛 버전(v' + (KK.extVersion || '?') + ')이라 내 블로그 서식 정리는 건너뛰어요. 새 폴더의 chrome-extension을 다시 불러오면 돼요.', 'error'); }
  const cover = await KK.exportCover(); if (!cover) throw Error('대표사진을 정해 주세요.');
  const images = [{ id: 'cover', kind: 'cover', blob: cover }];      // 사진은 원본에서 한 번에 만든 파일(Blob) — 보낼 때 나눠서 올려요 (export.js)
  const steps = [{ type: 'image', id: 'cover' }];
  if (!lemon) steps.push({ type: 'text', text: doc.specLines.join('\n') });
  if ($('optPlace').checked && s.apt) steps.push({ type: 'place', query: s.apt });
  steps.push({ type: 'text', text: doc.greeting });
  const native = lemon ? lemonStyle : $('optStyle').checked && KK.TEMPLATE;   // 기존 글 서식: 콜라주도 네이버 콜라주로
  for (const [ci, c] of s.cards.entries()) {
    if (lemon && doc.headings[ci]) steps.push({ type: 'text', text: KK.lemonHeadingText(doc.headings[ci]) });
    if (native && c.photoIds.length > 1) {
      for (const pid of c.photoIds) { const id = c.id + '_' + pid; images.push({ id, kind: 'body', blob: (await KK.exportPhoto(KK.photos.get(pid))).blob }); steps.push({ type: 'image', id }); }
    } else { images.push({ id: c.id, kind: 'body', blob: (await KK.exportCard(c)).blob }); steps.push({ type: 'image', id: c.id }); }
    steps.push({ type: 'text', text: c.text.trim() });
  }
  steps.push({ type: 'divider' });
  if (doc.footer && doc.footer.trim()) steps.push({ type: 'text', text: doc.footer, align: 'center' });
  if ($('optLink').checked && !native) steps.push({ type: 'link', url: doc.homepage });   // 서식 적용 시 기존 글의 링크 카드가 들어감
  const vTitle = ($('videoTitle').value || '').trim() || doc.videoTitle || doc.title;
  if (KK.videoFile) steps.push({ type: 'video', title: vTitle, tags: videoTags(doc) });
  const restyle = lemon ? (lemonStyle ? KK.lemonRestyle(doc, s, { video: KK.videoFile ? { title: vTitle, tags: videoTags(doc) } : null }) : null) : native ? {
    template: KK.TEMPLATE, spec: doc.specLines, greeting: doc.greeting.split('\n'),
    groups: s.cards.map(c => c.photoIds.length > 1 ? c.photoIds.length : 1), cards: s.cards.map(c => c.text.trim()),
    video: KK.videoFile ? { title: vTitle, tags: videoTags(doc) } : null
  } : null;
  return { doc, images, steps, restyle };
}

function videoTags(doc) {
  const typed = ($('videoTags').value || '').split(/[,\n#]/).map(t => t.trim()).filter(Boolean);
  return (typed.length ? typed : doc.tags).slice(0, 10);
}

/* 동영상 한 개를 설정합니다 (null이면 뺍니다) */
KK.setVideo = f => {
  setTimeout(videoNote, 0);
  const v = $('videoPreview'), name = $('videoName');
  if (v.src) { URL.revokeObjectURL(v.src); v.removeAttribute('src'); }
  KK.videoFile = f || null;
  if (f) {
    name.textContent = '🎬 ' + f.name + ' · ' + (f.size / 1048576).toFixed(1) + 'MB';
    v.src = URL.createObjectURL(f); v.hidden = false;
  } else {
    name.textContent = '동영상 파일을 끌어다 놓거나 눌러서 선택 (선택 사항)';
    v.hidden = true;
  }
  $('videoClear').hidden = !f;
  $('videoFields').hidden = !f;       // 영상이 있을 때만 제목·태그 칸을 보여줍니다
  KK.renderPreview();
};

async function stageVideo() {
  const r = await fetch('/api/media/stage-video', { method: 'POST', headers: { 'x-filename': encodeURIComponent(KK.videoFile.name) }, body: KK.videoFile });
  const j = await r.json(); if (!r.ok) throw Error(j.error || '동영상 준비 실패'); return j;
}
const blobToDataUrl = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(Error('사진을 읽지 못했어요.')); r.readAsDataURL(b); });
/* 원본 크기 사진은 한 번에 보내면 너무 커서 24MB 정도씩 나눠서 임시 폴더에 올려요 → { 사진 id → 파일 경로 } */
async function stageImages(images, jobs) {
  const paths = new Map(); let batch = [], size = 0;
  const flush = async () => {
    if (!batch.length) return;
    const payload = []; for (const im of batch) payload.push({ id: im.id, kind: im.kind, data: await blobToDataUrl(im.blob) });
    const st = await fetch('/api/media/stage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ images: payload }) });
    const j = await st.json().catch(() => ({})); if (!st.ok) throw Error(j.error || '사진 임시 파일 준비 실패');
    jobs.push(j.jobId); for (const x of j.images) paths.set(x.id, x.filePath);
    batch = []; size = 0;
  };
  for (const im of images) {
    if (batch.length && (size + im.blob.size > 24 * 1048576 || batch.length >= 30)) await flush();
    batch.push(im); size += im.blob.size;
  }
  await flush();
  return paths;
}
/* 보내기 앞의 영상 안내 한 줄 — 키친앤코·레몬하우스 모두 같아요 */
function videoNote() {
  const el = $('autoVideoNote'); if (!el) return;
  const on = $('optAutoVideo') && $('optAutoVideo').checked;
  el.textContent = KK.videoFile ? '🎬 올려 둔 동영상(' + KK.videoFile.name + ')을 글 맨 아래에 붙여요.'
    : on ? '🎬 사진들을 이어 붙인 영상을 자동으로 만들어 글 맨 아래에 붙여요. 만드는 동안(사진 1장에 약 2초) 이 창을 앞에 두세요. 끄려면 [보내기 옵션]의 자동 영상 체크를 빼세요.'
    : '🎬 자동 영상이 꺼져 있어요. 영상 없이 보내요. ([보내기 옵션]에서 켤 수 있어요)';
}
KK.videoNote = videoNote;
async function send() {
  const btn = $('naverSend'); if (btn.disabled) return;
  btn.disabled = true; const extraJobs = [];       // extraJobs: 임시로 만든 사진·동영상 폴더 번호 (끝나면 모두 지워요)
  try {
    if (!await KK.checkExtension()) throw Error('크롬 확장 프로그램이 연결되지 않았어요. 사용방법.txt의 설치 순서를 확인해 주세요.');
    $('diagCopy').hidden = true;
    checkLemonTexts();
    if (!KK.videoFile && $('optAutoVideo') && $('optAutoVideo').checked && KK.state.cards.length) {
      status('사진들로 영상을 만드는 중이에요… 끝날 때까지 이 창을 앞에 두세요.');
      try { KK.setVideo(await KK.makeSlideshow((t, n) => status('사진들로 영상을 만드는 중이에요… ' + t + '/' + n + '초 · 이 창을 앞에 두세요.'))); KK.autoVideo = true; }
      catch (e) { KK.toast('영상 만들기를 건너뛰었어요: ' + e.message, 'error'); }
    }
    status('사진과 원고를 준비하고 있어요…');
    if (KK.tidyOn && KK.tidyOn()) { const t = KK.tidyAll(); if (t) KK.toast(KK.lineOpt().mode === 'join' ? t + '개 문단의 줄바꿈을 없애 한 덩어리로 보내요.' : '네이버에서 글이 중간에 꺾이지 않게 ' + t + '개 문단의 줄을 정리했어요.', 'ok'); }
    const { doc, images, steps, restyle } = await buildPlan();
    const paths = await stageImages(images, extraJobs);
    let videoJob = null;
    if (steps.some(x => x.type === 'video')) { status('동영상 파일을 준비하고 있어요…'); videoJob = await stageVideo(); extraJobs.push(videoJob.jobId); }
    const plan = steps.map(x => x.type === 'image' ? { type: 'image', filePath: paths.get(x.id) } : x.type === 'video' ? { ...x, filePath: videoJob.filePath } : x);
    status('네이버 새 글쓰기 창을 열고 입력 중이에요. 사진 ' + images.length + '장 · 끝날 때까지 그 창을 건드리지 마세요…');
    const start = await KK.ext('INSERT_SAVE', { title: doc.title, plan, restyle, category: (window.KK_blogCategory && window.KK_blogCategory()) || null, schedule: readSched() }, 30000);
    let out = start;
    if (start.ok && start.started) {
      const STEP = { text: '글', image: '사진', place: '지도', link: '링크', divider: '구분선', video: '동영상' };
      const t0 = Date.now(); let misses = 0;
      for (;;) {
        await new Promise(r => setTimeout(r, 2000));
        const j = await KK.ext('JOB', { id: start.id }, 10000).catch(e => ({ ok: false, error: e.message }));
        if (!j.ok) { if (++misses > 15) { out = { ok: false, stage: '연결', error: '확장 프로그램 응답이 끊겼어요. ' + (j.error || '') }; break; } continue; }
        misses = 0;
        if (j.state === 'done') { out = j.result || { ok: false, error: '결과 없음' }; break; }
        if (j.state === 'lost') { out = { ok: false, stage: '확장', error: '입력 도중 확장 프로그램이 다시 시작됐어요. 편집기를 확인하고 새 글에서 다시 시도해 주세요.' }; break; }
        const m = /^(\d+)\/(\d+) (\w+)/.exec(j.progress || '');
        status('네이버에 입력 중… ' + (m ? m[1] + '/' + m[2] + ' 단계 (' + (STEP[m[3]] || m[3]) + ')' : (j.progress || '')) + ' · ' + Math.round((Date.now() - t0) / 1000) + '초\n끝날 때까지 그 창을 건드리지 마세요.');
        if (Date.now() - t0 > 30 * 60 * 1000) { out = { ok: false, stage: '시간 초과', error: '30분이 지나도 끝나지 않았어요.' }; break; }
      }
    }
    const skipped = (out.skipped || []).length ? '\n\n직접 추가가 필요한 항목: ' + out.skipped.join(', ') : '';
    const tagNote = '\n\n해시태그는 발행할 때 태그 칸에 붙여넣어 주세요 → [해시태그 복사]';
    // 임시저장까지 끝났으면 현장 목록에 '블로그 올림'으로 자동 기록 (발행 안 할 거면 [기록 취소])
    let recNote = '';
    if (out.ok && out.saved && window.KK_blogAutoRecord) { try { recNote = await window.KK_blogAutoRecord(); } catch (e) { recNote = '\n\n(시트 기록 요청은 남기지 못했어요: ' + e.message + ' — 아래 [발행·예약 완료 → 시트에 기록]을 눌러 주세요)'; } }
    // 구글 '블로그 관리 시트'에도 한 줄 기록 (키친앤코 탭 / 레몬하우스 내 블로그 탭)
    if (out.ok && out.saved && window.KK_sheetAutoRecord) { try { recNote += await window.KK_sheetAutoRecord(); } catch (e) { recNote += '\n\n(구글 시트 기록은 하지 못했어요: ' + e.message + ')'; } }
    if (out.ok && out.saved) status('✓ ' + out.message + skipped + tagNote + recNote, 'ok');
    else if (out.ok) status(out.message + skipped + tagNote, 'warn');
    else { $('diagCopy').hidden = false; status('중단됨 [' + (out.stage || '편집기') + ']: ' + (out.error || '원인 불명') + '\n\n이미 들어간 글·사진이 편집기에 남아 있을 수 있어요. 새 글쓰기 화면에서 다시 시도해 주세요.', 'error'); }
  } catch (e) { $('diagCopy').hidden = false; status(e.message, 'error'); }
  finally {
    for (const j of extraJobs) fetch('/api/media/cleanup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId: j }) }).catch(() => {});
    if (KK.autoVideo) { KK.autoVideo = false; KK.setVideo(null); }   // 자동으로 만든 영상은 다음 글에 남기지 않음
    btn.disabled = false;
  }
}

async function zipPack() {
  const s = KK.state, doc = KK.compose(s), cover = await KK.exportCover();
  const files = [], bytes = async b => new Uint8Array(await b.arrayBuffer());
  if (cover) files.push({ name: '00_대표사진_1080.jpg', data: await bytes(cover) });
  for (let i = 0; i < s.cards.length; i++) files.push({ name: String(i + 1).padStart(2, '0') + '_본문사진.jpg', data: await bytes((await KK.exportCard(s.cards[i])).blob) });
  files.push({ name: '원고.txt', data: '﻿' + KK.plainText(s, doc) });
  KK.download('키친앤코_' + (s.apt || '블로그') + '.zip', KK.zip(files));
}

KK.initNaver = () => {
  const vbox = $('videoBox');
  $('videoInput').addEventListener('change', e => { KK.setVideo(e.target.files[0]); e.target.value = ''; });
  $('videoClear').addEventListener('click', () => KK.setVideo(null));
  // 동영상 칸에 바로 끌어다 놓기
  ['dragenter', 'dragover'].forEach(ev => vbox.addEventListener(ev, e => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); vbox.classList.add('over'); } }));
  ['dragleave', 'drop'].forEach(ev => vbox.addEventListener(ev, () => vbox.classList.remove('over')));
  vbox.addEventListener('drop', e => { if (e.dataTransfer?.files?.length) { e.preventDefault(); KK.takeFiles(e.dataTransfer.files); } });
  $('captureTpl').addEventListener('click', async () => {
    try {
      const r = await KK.ext('CAPTURE_TEMPLATE', {}, 20000);
      if (!r.ok) throw Error(r.error);
      KK.store.set('kk2-template', r.template);
      KK.download('키친앤코_블로그서식.json', JSON.stringify(r, null, 1), 'application/json');
      KK.toast('서식 파일을 저장했어요. 채팅에 첨부해 주세요.', 'ok');
    } catch (e) { KK.toast('가져오기 실패: ' + e.message, 'error'); }
  });
  $('naverSend').addEventListener('click', send);
  $('videoProbe').addEventListener('click', async () => {
    const b = $('videoProbe'); b.disabled = true; b.textContent = '동영상 창을 열어 보는 중…';
    try {
      if (!await KK.checkExtension()) throw Error('크롬 확장 프로그램이 연결되지 않았어요.');
      status('네이버 글쓰기 화면에서 동영상 창을 열어 구조를 읽는 중이에요. 글은 바뀌지 않아요…');
      const r = await KK.ext('VIDEO_PROBE', {}, 90000);
      await KK.copy(JSON.stringify(r, null, 1));
      status(r.ok ? '✓ 동영상 창 구조를 복사했어요. 채팅에 붙여넣어 주세요.' : '구조를 읽지 못했어요: ' + (r.error || '') + '\n(복사는 됐으니 그대로 붙여넣어 주세요)', r.ok ? 'ok' : 'warn');
    } catch (e) { status(e.message, 'error'); }
    finally { b.disabled = false; b.textContent = '동영상 창 구조 보기 (동영상이 안 올라갈 때)'; }
  });
  $('publishProbe').addEventListener('click', async () => {
    const b = $('publishProbe'); b.disabled = true; b.textContent = '발행 창을 열어 보는 중…';
    try {
      if (!await KK.checkExtension()) throw Error('크롬 확장 프로그램이 연결되지 않았어요.');
      status('네이버 글쓰기 화면에서 [발행] 창을 열어 구조를 읽는 중이에요. 발행은 되지 않고 읽은 뒤 닫아요…');
      const r = await KK.ext('PUBLISH_PROBE', {}, 60000);
      await KK.copy(JSON.stringify(r, null, 1));
      status(r.ok ? '✓ 발행 창 구조를 복사했어요. 채팅에 붙여넣어 주세요.' : '구조를 읽지 못했어요: ' + (r.error || '') + '\n(복사는 됐으니 그대로 붙여넣어 주세요)', r.ok ? 'ok' : 'warn');
    } catch (e) { status(e.message, 'error'); }
    finally { b.disabled = false; b.textContent = '발행 창 구조 보기 (예약 발행 만들 때)'; }
  });
  $('diagCopy').addEventListener('click', async () => {
    const r = await KK.ext('DIAG', {}, 5000).catch(e => ({ ok: false, error: e.message }));
    await KK.copy(JSON.stringify(r, null, 1)); KK.toast('진단 정보를 복사했어요. 채팅에 붙여넣어 주세요.', 'ok');
  });
  const copy = (fn, label) => async () => { try { await KK.copy(fn()); KK.toast(label + '을(를) 복사했어요.', 'ok'); } catch (e) { KK.toast(e.message, 'error'); } };
  $('copyTitle').addEventListener('click', copy(() => KK.compose(KK.state).title, '제목'));
  $('copyAll').addEventListener('click', copy(() => KK.plainText(KK.state, KK.compose(KK.state)), '전체 원고'));
  $('copyTags').addEventListener('click', copy(() => KK.compose(KK.state).tags.map(t => '#' + t).join(' '), '해시태그'));
  $('copyVideo').addEventListener('click', copy(() => { const d = KK.compose(KK.state); return '제목: ' + d.title + '\n태그: ' + d.tags.join(', '); }, '동영상 제목·태그'));
  $('zipPack').addEventListener('click', () => zipPack().catch(e => KK.toast(e.message, 'error')));
  if ($('optAutoVideo')) $('optAutoVideo').addEventListener('change', videoNote);
  videoNote();
  setTimeout(KK.checkExtension, 600);
};
})();
