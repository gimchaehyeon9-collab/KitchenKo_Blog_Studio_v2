// 내 PC의 스튜디오 화면(127.0.0.1) ↔ 확장 프로그램 사이의 메시지 다리
(() => {
  'use strict';
  if (location.hostname !== '127.0.0.1') return;
  const ALLOWED = new Set(['PING', 'OPEN', 'CHECK', 'INSERT_SAVE', 'KEYWORD_VOLUME', 'DIAG', 'CAPTURE_TEMPLATE', 'READ_LAND', 'READ_CAFE', 'LAND_SEARCH', 'LAND_SELECT', 'LAND_DETAILS', 'JOB', 'VIDEO_PROBE', 'SCHED_READ', 'FILM_OPEN', 'FILM_PHOTO', 'FILM_CLOSE']);
  window.addEventListener('message', e => {
    if (e.source !== window || e.origin !== location.origin) return;
    const m = e.data;
    if (!m || m.source !== 'KK_PAGE' || !/^kk-[a-z0-9]{4,20}$/.test(String(m.id || '')) || !ALLOWED.has(m.action)) return;
    const reply = answer => window.postMessage({ source: 'KK_EXT', id: m.id, answer }, location.origin);
    try {
      chrome.runtime.sendMessage({ action: m.action, payload: m.payload || {} }, answer => {
        const err = chrome.runtime.lastError;
        reply(err ? { ok: false, error: '확장 프로그램 연결이 끊겼어요. 이 탭을 새로고침해 주세요. (' + err.message + ')' } : (answer || { ok: false, error: '빈 응답' }));
      });
    } catch (err) {
      reply({ ok: false, error: '확장 프로그램이 업데이트되었어요. 이 탭을 새로고침해 주세요.' });
    }
  });
})();
