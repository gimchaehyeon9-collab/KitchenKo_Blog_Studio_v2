/* 구글 '블로그 관리 알바 작업시트' 자동 기록
   - 키친앤코: [키친앤코] 탭에 날짜 · 현장명 · 품목 · 키워드(· 링크) 한 줄
   - 레몬하우스: 내 블로그 탭에 한 줄 (칸과 [시트에 기록]은 lemon.js)
   네이버 임시저장이 끝나는 순간 KK_sheetAutoRecord()가 두 브랜드 모두 알맞은 쪽으로 기록해요. */
(() => {
'use strict';
const KK = window.KK;
const $ = id => document.getElementById(id);
const api = async (url, body) => {
  const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  if (r.status === 404) throw Error(STALE);
  const j = await r.json().catch(() => ({ ok: false, error: '응답을 읽지 못했어요.' }));
  if (!j.ok) throw Error(j.error || '요청 실패'); return j;
};
// 새 파일로 덮어썼는데 예전 스튜디오 프로그램이 계속 켜져 있으면, 화면은 새 것이어도 서버는 예전 기능이에요
const STALE = '스튜디오 프로그램이 예전 버전으로 켜져 있어요. 작업 관리자(Ctrl+Shift+Esc)에서 Node.js(node.exe)를 모두 [작업 끝내기] 한 뒤 start.vbs를 다시 실행해 주세요.';
const AUTO_KEY = 'kk-sheet-auto';
const autoOn = () => { try { return localStorage.getItem(AUTO_KEY) !== '0'; } catch (_) { return true; } };
const NOURL = '\n\n(구글 시트 연결이 아직 안 돼 있어서 시트 기록은 건너뛰었어요 — [점검·보내기] 단계의 [시트 기록] 안에 있는 [시트 연결 설정]에서 한 번만 넣어 주세요)';

/* ───────── 키친앤코 칸 ───────── */
const dirty = {};
let lastSite = '';
function defaults() {
  const info = window.KK_blogRecInfo ? window.KK_blogRecInfo() : { site: '', items: [] };
  let kw = '';
  try { const k = KK.keywords(KK.state); kw = k.A ? k.A + (k.B && k.B !== k.A ? ' / ' + k.B : '') : ''; } catch (_) {}
  return { date: KK.postDate ? KK.postDate() : '', site: info.site, item: info.items.join(', '), kw };
}
// 칸 내용을 지금 글·현장에 맞게 다시 채움 (사용자가 직접 고친 칸은 그대로 둠). 다른 현장을 보내면 새 글이므로 고친 내용도 비움
KK.sheetSync = function sheetSync() {
  if (!$('ksDate')) return;
  const d = defaults();
  if (d.site !== lastSite) { lastSite = d.site; for (const k of ['ksSite', 'ksItem', 'ksKw', 'ksLink']) dirty[k] = false; $('ksLink').value = ''; }
  const map = { ksDate: d.date, ksSite: d.site, ksItem: d.item, ksKw: d.kw };
  for (const [id, v] of Object.entries(map)) if (!dirty[id]) $(id).value = v;
};
window.KK_sheetSync = () => KK.sheetSync();

function status(m, k) { const el = $('ksStatus'); el.hidden = !m; el.textContent = m || ''; el.className = 'status ' + (k || ''); }
const kitchenDone = j => '✓ ' + j.tab + ' 탭 ' + j.row + '행' + (j.mode === 'same' ? '에 이미 같은 글이 적혀 있어서 새 줄은 만들지 않았어요' + (j.linked ? ' (링크를 채웠어요)' : '') : j.mode === 'fill' ? '을 채웠어요' : j.mode === 'shift' ? '에 날짜 순서에 맞게 끼워 넣었어요' : '에 새 줄로 넣었어요') + '.';
async function recordKitchen(auto) {
  if (auto) KK.sheetSync();
  const j = await api('/api/lemon/ksheet', { date: $('ksDate').value, site: $('ksSite').value, item: $('ksItem').value, keywords: $('ksKw').value, link: $('ksLink').value, auto: !!auto });
  $('ksRetry').hidden = true;
  return j;
}

/* ───────── 임시저장 직후 자동 기록 (naver.js가 부름) ───────── */
window.KK_sheetAutoRecord = async () => {
  if (!autoOn()) return '';
  const lemon = KK.brandKey === 'lemon';
  try {
    const j = lemon ? await KK.recordLemon(true) : await recordKitchen(true);
    if (j.skipped === 'nourl') return NOURL;
    const msg = lemon ? KK.lemonDone(j) : kitchenDone(j);
    if (lemon) KK.lemonRecStatus(msg, 'ok'); else status(msg, 'ok');
    return '\n\n구글 시트에 기록했어요. ' + msg.replace(/^✓ /, '');
  } catch (e) {
    if (!lemon) { $('ksRetry').hidden = false; status(e.message, 'error'); }
    return '\n\n(구글 시트 기록은 하지 못했어요: ' + e.message + ' — 아래 [시트에 기록]에서 내용을 확인하고 다시 눌러 주세요)';
  }
};

/* ───────── 설정 · 버튼 ───────── */
function setStatus2(m, k) { const el = $('ksSetStatus'); el.hidden = !m; el.textContent = m || ''; el.className = 'status ' + (k || ''); }
async function loadCfg() {
  try {
    const j = await api('/api/lemon/status');
    $('ksUrl').value = j.settings.sheetUrl || '';
    $('ksKey').placeholder = j.settings.hasSheetKey ? '(저장돼 있어요 — 바꿀 때만 다시 입력)' : '';
    $('ksRetry').hidden = !j.pending;
    $('ksCfgNote').textContent = j.settings.sheetUrl ? '시트 연결 주소가 저장돼 있어요.' : '아직 연결 전이에요.';
  } catch (_) {}
}
function init() {
  if (!$('ksDate')) return;
  ['ksDate', 'ksSite', 'ksItem', 'ksKw', 'ksLink'].forEach(id => $(id).addEventListener('input', () => { dirty[id] = true; }));
  ['apt', 'optSched', 'optSchedDate'].forEach(id => $(id) && $(id).addEventListener('input', () => setTimeout(KK.sheetSync, 50)));
  ['optSched', 'optSchedDate'].forEach(id => $(id) && $(id).addEventListener('change', () => setTimeout(KK.sheetSync, 50)));
  // 자동 기록 켜기/끄기 (키친앤코·레몬하우스 칸이 같은 설정을 써요)
  const autos = [$('ksAuto'), $('lrAuto')].filter(Boolean);
  autos.forEach(c => { c.checked = autoOn(); c.addEventListener('change', () => { try { localStorage.setItem(AUTO_KEY, c.checked ? '1' : '0'); } catch (_) {} autos.forEach(o => { o.checked = c.checked; }); }); });
  $('ksSave').addEventListener('click', async () => {
    const btn = $('ksSave'); btn.disabled = true; status('시트에 기록하는 중…');
    try { status(kitchenDone(await recordKitchen(false)), 'ok'); }
    catch (e) { status(e.message, 'error'); await loadCfg(); }
    finally { btn.disabled = false; }
  });
  $('ksCopy').addEventListener('click', async () => {
    await KK.copy([$('ksDate').value, $('ksSite').value, $('ksItem').value, $('ksKw').value, '', $('ksLink').value].join('\t'));
    KK.toast('한 줄을 복사했어요. 시트의 해당 줄 첫 칸에 붙여넣기 하세요.', 'ok');
  });
  $('ksRetry').addEventListener('click', async () => {
    try { const j = await api('/api/lemon/retry', {}); status(j.done + '건을 보냈어요' + (j.left ? ' · 못 보낸 것 ' + j.left + '건' : '') + '.', j.left ? 'error' : 'ok'); $('ksRetry').hidden = !j.left; }
    catch (e) { status(e.message, 'error'); }
  });
  $('ksSaveSet').addEventListener('click', async () => {
    try {
      const body = { sheetUrl: $('ksUrl').value };
      if ($('ksKey').value.trim()) body.sheetKey = $('ksKey').value;
      const j = await api('/api/lemon/settings', body); $('ksKey').value = ''; await loadCfg();
      if (j.warn) setStatus2('저장은 했지만 주소를 확인해 주세요. ' + j.warn, 'error'); else setStatus2('저장했어요. [시트 연결 확인]을 눌러 보세요.', 'ok');
    } catch (e) { setStatus2(e.message, 'error'); }
  });
  $('ksPing').addEventListener('click', async () => {
    setStatus2('확인 중…');
    try {
      const j = await api('/api/lemon/ping');
      if (j.kitchen === undefined) setStatus2(STALE, 'error');
      else if (j.kitchen) setStatus2('✓ ' + (j.ping || '연결됐어요'), 'ok');
      else setStatus2('연결은 됐지만 시트에 설치된 스크립트가 예전 버전(레몬하우스 전용)이에요. 새 ‘블로그시트연결.gs’로 바꿔 붙여넣고 [배포 → 배포 관리 → 새 버전]으로 다시 배포해 주세요.', 'error');
    } catch (e) { setStatus2(e.message, 'error'); }
  });
  KK.sheetSync();
  setTimeout(loadCfg, 800);
}

/* ───────── 어제 글 링크 · 네이버 노출 순위 (rank.js) ───────── */
const RK_AUTO = 'kk-rank-auto', RK_LAST = 'kk-rank-last';
const rkAutoOn = () => { try { return localStorage.getItem(RK_AUTO) !== '0'; } catch (_) { return true; } };
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
function rkStatus(m, k) { const el = $('rkStatus'); if (!el) return; el.hidden = !m; el.textContent = m || ''; el.className = 'status ' + (k || ''); }
function rkSummary(j, dry) {
  const rs = j.results || [];
  if (!j.checked) return { msg: '✓ 링크·순위를 채울 전날 글이 없어요 (이미 다 적혀 있어요).', list: '', kind: 'ok' };
  const bad = rs.filter(r => !r.link);
  const head = dry ? '미리보기 · 전날 글 ' + j.checked + '건 확인' : '✓ 전날 글 ' + j.checked + '건 확인 · ' + rs.filter(r => r.link).length + '건 기록';
  const list = rs.map(r => '• ' + r.date + ' ' + r.site + ' → ' + (r.link ? (r.rank ? r.rank : '(순위 없음)') + ' · ' + r.link : '건너뜀') + (r.note && !dry ? '  [' + r.note + ']' : '') + (dry && r.note ? '  [' + r.note + ']' : '')).join('\n');
  return { msg: head + (bad.length ? ' · 못 찾은 글 ' + bad.length + '건 (아래 설명)' : '') + (j.rankOn ? '' : ' · 네이버 API 키가 없어 링크만 채웠어요') + (j.rankFail ? ' · 순위 조회 실패: ' + j.rankFail : ''), list, kind: bad.length || j.rankFail ? 'error' : 'ok' };
}
let rkBusy = false;
async function rkRun(dry, auto) {
  if (rkBusy) return;
  rkBusy = true;
  rkStatus(auto ? '전날 글 링크·순위를 확인하는 중…' : (dry ? '미리보기 조회 중… (네이버 조회는 키워드마다 몇 초 걸려요)' : '시트에 기록하는 중… (네이버 조회는 키워드마다 몇 초 걸려요)'));
  try {
    const j = await api('/api/rank/run', { dryRun: !!dry });
    const sm = rkSummary(j, dry);
    rkStatus(sm.msg, sm.kind); $('rkList').textContent = sm.list;
    if (!dry && !(j.results || []).some(r => /실패/.test(r.note))) { try { localStorage.setItem(RK_LAST, kstToday()); } catch (_) {} }
  } catch (e) { rkStatus(e.message, 'error'); $('rkList').textContent = ''; }
  finally { rkBusy = false; }
}
async function rkLoadCfg() {
  try {
    const j = await api('/api/rank/status');
    $('rkId').value = j.naverId || ''; $('rkSecret').value = j.naverSecret || '';
    if ($('rkProvider')) $('rkProvider').value = j.provider === 'legacy' || j.provider === 'hub' ? j.provider : 'tab';
    rkSyncProvider();
    $('rkCfgNote').textContent = j.provider === 'tab' || !j.provider ? '✓ 키 없이 네이버 블로그탭 검색으로 상위 20위 안의 순위를 찾아 기록해요.' : (j.configured ? '✓ 네이버 검색 API 키가 저장돼 있어요. 링크와 순위를 모두 기록해요.' : '이 방식은 키가 있어야 순위를 조회해요. 키가 없으면 링크만 채우고 순위는 건너뛰어요.');
  } catch (e) { if (e.message === STALE) rkStatus(e.message, 'error'); }
}
function rkSyncProvider() { const v = $('rkProvider') ? $('rkProvider').value : 'tab'; if ($('rkKeys')) $('rkKeys').hidden = v === 'tab'; if ($('rkTabHelp')) $('rkTabHelp').hidden = v !== 'tab'; }
function rkInit() {
  if (!$('rkRun')) return;
  if ($('rkProvider')) $('rkProvider').addEventListener('change', rkSyncProvider);
  $('rkAuto').checked = rkAutoOn();
  $('rkAuto').addEventListener('change', () => { try { localStorage.setItem(RK_AUTO, $('rkAuto').checked ? '1' : '0'); } catch (_) {} });
  $('rkRun').addEventListener('click', () => rkRun(false, false));
  $('rkPreview').addEventListener('click', () => rkRun(true, false));
  $('rkSave').addEventListener('click', async () => {
    try { await api('/api/rank/settings', { naverId: $('rkId').value, naverSecret: $('rkSecret').value, provider: $('rkProvider') ? $('rkProvider').value : 'tab' }); await rkLoadCfg(); rkStatus('저장했어요. [미리보기]로 순위가 잘 나오는지 먼저 확인해 보세요.', 'ok'); }
    catch (e) { rkStatus(e.message, 'error'); }
  });
  rkLoadCfg();
  // 하루 한 번: 스튜디오를 켠 날 처음이면 자동으로 (시트 연결이 아직 없으면 조용히 건너뜀)
  setTimeout(async () => {
    if (!rkAutoOn()) return;
    let last = ''; try { last = localStorage.getItem(RK_LAST) || ''; } catch (_) {}
    if (last === kstToday()) return;
    rkRun(false, true);
  }, 6000);
}
/* ───────── 레몬하우스: 어제 글 노출 순위 (rank.js · 2.10.36) ───────── */
const LRK_AUTO = 'kk-lrank-auto', LRK_LAST = 'kk-lrank-last';
const lrkAutoOn = () => { try { return localStorage.getItem(LRK_AUTO) !== '0'; } catch (_) { return true; } };
function lrkStatus(m, k) { const el = $('lrkStatus'); if (!el) return; el.hidden = !m; el.textContent = m || ''; el.className = 'status ' + (k || ''); }
function lrkSummary(j, dry) {
  const rs = j.results || [], blog = j.blog === '메인' ? '메인' : (j.blog || '') + '번';
  if (!j.checked) return j.noRankCol
    ? { msg: '이 탭(' + (j.tab || blog) + ') 제목 줄에 순위 칸(제목에 ‘순위’·‘노출’·‘D+1’)이 없어서 순위를 적을 수 없어요.', list: '', kind: 'error' }
    : { msg: '✓ 순위를 채울 전날 글이 없어요 (이미 다 적혀 있거나 키워드 칸이 비어 있어요).', list: '', kind: 'ok' };
  const done = rs.filter(r => r.rank), lost = rs.filter(r => !r.link);
  const list = rs.map(r => '• ' + r.date + ' ' + r.site + ' → ' + (r.rank ? r.rank : (r.link ? '(순위 없음)' : '건너뜀')) + (r.note ? '  [' + r.note + ']' : '')).join('\n');
  const head = (dry ? '미리보기 · ' : '✓ ') + blog + ' 탭 · 전날 글 ' + j.checked + '건 확인' + (dry ? '' : ' · 순위 ' + done.length + '건 기록');
  return { msg: head + (lost.length ? ' · 못 찾은 글 ' + lost.length + '건 (아래 설명)' : '') + (j.rankOn ? '' : ' · 네이버 API 키가 없어 순위는 건너뛰었어요') + (j.rankFail ? ' · 순위 조회 실패: ' + j.rankFail : ''), list, kind: lost.length || j.rankFail ? 'error' : 'ok' };
}
async function lrkRun(dry, auto) {
  if (rkBusy) { if (!auto) lrkStatus('다른 순위 기록이 아직 돌아가는 중이에요. 끝난 뒤 다시 눌러 주세요.', 'error'); return; }
  rkBusy = true;
  lrkStatus(auto ? '전날 글 순위를 확인하는 중…' : (dry ? '미리보기 조회 중… (네이버 조회는 키워드마다 몇 초 걸려요)' : '시트에 기록하는 중… (네이버 조회는 키워드마다 몇 초 걸려요)'));
  try {
    const j = await api('/api/rank/lemon', { dryRun: !!dry, auto: !!auto });
    if (j.skipped) { lrkStatus(''); $('lrkList').textContent = ''; return; }          // 자동인데 시트 연결·내 블로그가 아직이면 조용히 건너뜀
    const sm = lrkSummary(j, dry);
    lrkStatus(sm.msg, sm.kind); $('lrkList').textContent = sm.list;
    if (!dry && !(j.results || []).some(r => /실패/.test(r.note))) { try { localStorage.setItem(LRK_LAST, kstToday()); } catch (_) {} }
  } catch (e) { lrkStatus(e.message, 'error'); $('lrkList').textContent = ''; }
  finally { rkBusy = false; }
}
function lrkInit() {
  if (!$('lrkRun')) return;
  $('lrkAuto').checked = lrkAutoOn();
  $('lrkAuto').addEventListener('change', () => { try { localStorage.setItem(LRK_AUTO, $('lrkAuto').checked ? '1' : '0'); } catch (_) {} });
  $('lrkRun').addEventListener('click', () => lrkRun(false, false));
  $('lrkPreview').addEventListener('click', () => lrkRun(true, false));
  // 하루 한 번: 레몬하우스 화면으로 스튜디오를 켠 날 처음이면 자동으로 (키친앤코 자동 기록이 끝난 뒤에)
  setTimeout(async () => {
    if (!lrkAutoOn() || KK.brandKey !== 'lemon') return;
    let last = ''; try { last = localStorage.getItem(LRK_LAST) || ''; } catch (_) {}
    if (last === kstToday()) return;
    for (let i = 0; i < 120 && rkBusy; i++) await new Promise(r => setTimeout(r, 5000));
    lrkRun(false, true);
  }, 9000);
}
document.addEventListener('DOMContentLoaded', () => { init(); rkInit(); lrkInit(); });
})();
