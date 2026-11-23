/* 레몬하우스 [카페 공사전·중] 탭 — 별도 프로그램(카페 공사중 자동 발행)을 Studio가 같이 켜고, 그 화면을 이 탭 안에 넣어 보여 줘요 (2.10.30).
   Studio가 하는 일: 폴더 확인 → 꺼져 있으면 켜기 → 켜지면 화면(iframe) 연결. 카페 설정·로그인·작업 기록은 그 프로그램이 따로 관리해요. */
(() => {
'use strict';
const KK = window.KK;
const $ = id => document.getElementById(id);
const api = async (url, body) => {
  const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const j = await r.json().catch(() => ({ ok: false, error: '응답을 읽지 못했어요.' }));
  if (!j.ok) throw Error(j.error || '요청 실패'); return j;
};
let busy = false, frameUrl = '';
function stat(msg, kind) { const el = $('cafeStatus'); if (!el) return; el.hidden = !msg; el.textContent = msg || ''; el.className = 'status ' + (kind || ''); }
function showFrame(url) {
  const f = $('cafeFrame'), a = $('cafeNew');
  if (frameUrl !== url || f.getAttribute('src') === 'about:blank') { f.src = url; frameUrl = url; }
  f.hidden = false; $('cafeRetryRow').hidden = true; a.href = url; a.hidden = false; stat('');
}
function showProblem(msg, canRetry) {
  $('cafeFrame').hidden = true; $('cafeNew').hidden = true; $('cafeRetryRow').hidden = !canRetry; stat(msg, 'error');
}
KK.cafeOpen = async (force) => {
  if (busy) return; busy = true;
  try {
    stat('카페 프로그램을 확인하는 중…');
    let j = await api('/api/cafeapp/status');
    if (!$('cafeDir').value) $('cafeDir').value = j.dir || '';
    if (!j.dirOk) return showProblem(j.problem + '\n위쪽 [프로그램 위치]에서 폴더를 바로잡아 주세요.', false);
    if (!j.running) { stat('카페 프로그램을 켜는 중… (처음엔 10~20초 걸려요)'); j = await api('/api/cafeapp/start', {}); }
    else j.url = j.url || ('http://127.0.0.1:' + j.port);
    showFrame(j.url + '/cafe.html' + (force ? '?r=' + Date.now() : ''));
  } catch (e) { showProblem(e.message, true); }
  finally { busy = false; }
};
document.addEventListener('DOMContentLoaded', () => {
  if (!$('hubCafe')) return;
  $('cafeRetry').addEventListener('click', () => KK.cafeOpen(true));
  $('cafeReload').addEventListener('click', () => { const f = $('cafeFrame'); if (!f.hidden && f.contentWindow) { try { f.contentWindow.location.reload(); } catch (_) { f.src = f.src; } } else KK.cafeOpen(true); });
  $('cafeDirSave').addEventListener('click', async () => {
    try { await api('/api/cafeapp/settings', { dir: $('cafeDir').value }); stat('저장했어요. 다시 켜는 중…'); frameUrl = ''; await KK.cafeOpen(true); }
    catch (e) { showProblem(e.message, false); }
  });
});
})();
