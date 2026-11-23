// 키친앤코 블로그 스튜디오 확장 v2.0
// · 모든 작업은 내 PC 스튜디오 화면의 버튼으로만 시작됩니다.
// · 아이디/비밀번호/쿠키를 읽거나 저장하지 않습니다.
// · 네이버 '발행'·'예약' 버튼은 절대 누르지 않습니다. 임시저장만 합니다.
importScripts('places.js', 'land.js', 'film.js');   // 네이버 부동산 단지 조회 (2.10.23) · 일정 사이트→아인 사진 가져오기 (2.10.38)
const HOME = 'https://blog.naver.com/kitchennko';
const SEARCHAD = 'https://manage.searchad.naver.com/';
const WRITE_URL = 'https://blog.naver.com/GoBlogWrite.naver';
let lastDiag = {};
/* 진단 기록은 크롬 저장소에도 남김 — 확장이 잠들었다 깨어나도 [진단 정보 복사]에 남도록 */
let diagTimer = 0;
const saveDiag = () => { clearTimeout(diagTimer); diagTimer = setTimeout(() => chrome.storage.local.set({ kkDiag: lastDiag }).catch(() => {}), 300); };
const progress = msg => { lastDiag.progress = msg; if (job) job.progress = msg; saveDiag(); };
/* 입력 작업 — 오래 걸려도(동영상 등) 끊기지 않게, 시작만 하고 화면이 상태를 물어보는 방식 */
let job = null;
async function runJob(p) {
  const keep = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000);   // 크롬이 확장을 재우지 않게
  try {
    progress('글쓰기 창 여는 중');
    const ed = await openEditor();
    const out = ed.ok ? await fillAndSave(ed, p.title, p.plan, p.restyle, p.category, p.schedule) : ed;
    if (!out.ok) { lastDiag.error = out.stage + ': ' + out.error; out.diag = lastDiag; }
    return out;
  } catch (e) {
    lastDiag.error = 'exception: ' + String(e?.message || e); lastDiag.stack = String(e?.stack || '').slice(0, 600);
    return { ok: false, stage: '확장', error: String(e?.message || e), diag: lastDiag };
  } finally { clearInterval(keep); lastDiag.finished = new Date().toISOString(); saveDiag(); }
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const clean = s => String(s || '').replace(/[​-‍﻿]/g, '').replace(/\s+/g, ' ').trim();

/* ───────────── 공통: 화면 좌표 클릭 · 글자 입력 ───────────── */
// 프레임(iframe) 안 요소의 좌표를 탭 전체 좌표로 바꾸는 코드 (페이지 안에서 실행)
const FRAME_OFFSET = `function kkPoint(n){n.scrollIntoView({block:'center',inline:'nearest'});const b=n.getBoundingClientRect();let x=b.left+b.width/2,y=b.top+Math.min(b.height/2,18),ok=true;try{let w=window;while(w!==w.top){const f=w.frameElement;if(!f){ok=false;break;}const r=f.getBoundingClientRect();x+=r.left;y+=r.top;w=w.parent;}}catch(e){ok=false;}return {x:Math.round(x),y:Math.round(y),width:Math.round(b.width),height:Math.round(b.height),offsetKnown:ok};}`;

async function run(tabId, frameIds, func, args = []) {
  const target = frameIds === 'all' ? { tabId, allFrames: true } : { tabId, frameIds: [frameIds] };
  const r = await chrome.scripting.executeScript({ target, func, args });
  return frameIds === 'all' ? r : r?.[0]?.result;
}
async function click(dbg, pt) {
  if (!pt?.offsetKnown || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) throw Error('클릭할 위치를 안전하게 확인하지 못했어요.');
  for (const [type, button, buttons] of [['mouseMoved', 'none', 0], ['mousePressed', 'left', 1], ['mouseReleased', 'left', 0]])
    await chrome.debugger.sendCommand(dbg, 'Input.dispatchMouseEvent', { type, button, buttons, clickCount: type === 'mousePressed' ? 1 : 0, x: pt.x, y: pt.y });
  await wait(140);
}
async function type(dbg, text) {
  for (let i = 0; i < text.length; i += 500) { await chrome.debugger.sendCommand(dbg, 'Input.insertText', { text: text.slice(i, i + 500) }); await wait(35); }
}
async function key(dbg, k, code, vk, text) {
  await chrome.debugger.sendCommand(dbg, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  if (text) await chrome.debugger.sendCommand(dbg, 'Input.dispatchKeyEvent', { type: 'char', text, key: k, code, windowsVirtualKeyCode: vk });
  await chrome.debugger.sendCommand(dbg, 'Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
}
const enter = dbg => key(dbg, 'Enter', 'Enter', 13, '\r');
const escape = dbg => key(dbg, 'Escape', 'Escape', 27);
async function typeLines(dbg, text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  for (let i = 0; i < lines.length; i++) { if (i) await enter(dbg); if (lines[i]) await type(dbg, lines[i]); }
}
async function focusTab(tab) { await chrome.tabs.update(tab.id, { active: true }); await chrome.windows.update(tab.windowId, { focused: true }); await wait(200); }

/* ───────────── 네이버 스마트에디터 찾기 · 상태 읽기 ───────────── */
async function getEditor() {
  const tabs = await chrome.tabs.query({ url: 'https://blog.naver.com/*' });
  for (const tab of tabs.sort((a, b) => Number(b.active) - Number(a.active))) {
    try {
      const frames = await run(tab.id, 'all', () => ({ title: !!document.querySelector('.se-documentTitle'), body: !!document.querySelector('.se-main-container,.se-content') }));
      const hit = frames.find(f => f.result?.title && f.result?.body) || frames.find(f => f.result?.title);
      if (hit) return { ok: true, tab, tabId: tab.id, frameId: hit.frameId };
    } catch (_) {}
  }
  return { ok: false, stage: 'editor', error: '네이버 글쓰기 화면을 찾지 못했어요. 크롬에서 네이버 블로그 → [글쓰기]로 빈 새 글을 열어 주세요.' };
}

// 편집기 안에서 실행: 제목/본문 상태와 클릭 위치
function readEditor(step, pointSrc) {
  const kkPoint=n=>{n.scrollIntoView({block:'center',inline:'nearest'});const b=n.getBoundingClientRect();let x=b.left+b.width/2,y=b.top+Math.min(b.height/2,18),ok=true;try{let w=window;while(w!==w.top){const f=w.frameElement;if(!f){ok=false;break;}const r=f.getBoundingClientRect();x+=r.left;y+=r.top;w=w.parent;}}catch(e){ok=false;}return {x:Math.round(x),y:Math.round(y),width:Math.round(b.width),height:Math.round(b.height),offsetKnown:ok};};
  const txt = n => { if (!n) return ''; const c = n.cloneNode(true); c.querySelectorAll('.se-placeholder,script,style').forEach(x => x.remove()); return (c.innerText || c.textContent || '').replace(/[​-‍﻿]/g, '').replace(/\s+/g, ' ').trim(); };
  const vis = n => n && n.getClientRects().length && n.getBoundingClientRect().width > 20;
  const notTitle = n => !n.closest('.se-documentTitle');
  const title = document.querySelector('.se-documentTitle');
  const tp = title?.querySelector('.se-text-paragraph');
  const paras = [...document.querySelectorAll('.se-main-container .se-text-paragraph,.se-content .se-text-paragraph')].filter(n => vis(n) && notTitle(n));
  const comps = [...document.querySelectorAll('.se-main-container .se-component,.se-content .se-component')].filter(n => notTitle(n) && !n.closest('.se-documentTitle') && !n.classList.contains('se-documentTitle'));
  const media = comps.filter(n => !n.classList.contains('se-text'));
  const placeholder = [...document.querySelectorAll('.se-main-container .se-placeholder,.se-content .se-placeholder')].find(n => vis(n) && notTitle(n));
  const out = {
    hasTitle: !!title, titleText: txt(tp), bodyText: paras.map(txt).filter(Boolean).join('\n'),
    paraCount: paras.length, mediaCount: media.length, imageCount: comps.filter(n => n.classList.contains('se-image') || n.classList.contains('se-imageStrip') || n.querySelector('.se-image-resource')).length,
    hasBody: !!(paras.length || placeholder)
  };
  if (step === 'title') out.point = kkPoint(title.querySelector('.se-placeholder') || tp || title);
  if (step === 'body') out.point = paras[0] ? kkPoint(paras[0]) : placeholder ? kkPoint(placeholder) : null;
  if (step === 'after-last') {
    // 마지막 사진/카드 다음 문단 (없으면 사진 자체)
    const last = media.at(-1);
    const next = last && paras.find(p => last.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING);
    out.hasNext = !!next; out.point = next ? kkPoint(next) : last ? kkPoint(last) : null;
  }
  if (step === 'end') out.point = paras.length ? kkPoint(paras.at(-1)) : null;
  return out;
}
const inspect = (ed, step) => run(ed.tabId, ed.frameId, readEditor, [step, FRAME_OFFSET]);

/* 툴바 버튼 찾기 (사진 / 장소 / 링크) */
// 후보가 여러 개면 점수로 하나를 고릅니다: data-name 정확히 일치 > 라벨 정확히 일치 > 화면 위쪽(상단 툴바)
async function toolbarButton(ed, labelRe, dataName) {
  const frames = await run(ed.tabId, 'all', (re, dn) => {
    const kkPoint=n=>{const b=n.getBoundingClientRect();let x=b.left+b.width/2,y=b.top+b.height/2,ok=true;try{let w=window;while(w!==w.top){const f=w.frameElement;if(!f){ok=false;break;}const r=f.getBoundingClientRect();x+=r.left;y+=r.top;w=w.parent;}}catch(e){ok=false;}return {x:Math.round(x),y:Math.round(y),width:Math.round(b.width),height:Math.round(b.height),offsetKnown:ok};};
    const R = new RegExp(re, 'i'); const out = [];
    for (const n of document.querySelectorAll('button,[role="button"]')) {
      const name = n.dataset?.name || '';
      const label = [n.getAttribute('aria-label'), n.getAttribute('title'), name, n.dataset?.log, (n.innerText || '').trim()].filter(Boolean).join(' ');
      const parts = [(n.innerText || '').trim(), n.getAttribute('aria-label') || '', n.getAttribute('title') || ''];
      if (!(name === dn || parts.some(t => R.test(t.trim()))) || /발행|예약|SNS|글감/.test(label) || (dn !== 'video' && /동영상/.test(label))) continue;
      const r = n.getBoundingClientRect(); if (r.width < 10 || r.width > 220 || r.height > 120 || !n.getClientRects().length) continue;
      const text = (n.innerText || n.getAttribute('aria-label') || '').trim();
      const score = (name === dn ? 100 : 0) + (R.test(text) && text.length <= 4 ? 20 : 0) + (n.closest('.se-toolbar,[class*="toolbar"]') ? 10 : 0);
      out.push({ label: label.slice(0, 50), cls: String(n.className || '').slice(0, 70), score, ...kkPoint(n) });
    }
    return out;
  }, [String(labelRe), dataName]);
  const hits = frames.flatMap(f => f.result || []).filter(h => h.offsetKnown);
  const uniq = [...new Map(hits.map(h => [Math.round(h.x / 8) + ':' + Math.round(h.y / 8), h])).values()];
  uniq.sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x);
  return { best: uniq[0] || null, candidates: uniq.map(h => `${h.label} [${h.cls}] score${h.score} @${h.x},${h.y}`) };
}

/* 사진 1장 업로드: 네이버 사진 버튼 → 파일 선택창을 가로채 실제 파일 경로 입력
   (2.10.26) 선택창이 안 열리면 바로 포기하지 않고 기다렸다가 다시 눌러 봐요. 앞 사진을 네이버로 올리는 중이면 [사진] 버튼이 잠깐 안 먹을 수 있어서요(사진이 원본 크기가 되면서 더 잘 생김).
   안 열린 상태에서는 사진이 하나도 안 들어갔으니(들어갔는지 매번 확인) 다시 눌러도 같은 사진이 두 번 들어가지 않아요. */
const CHOOSER_TRIES = 4;
async function openChooserAndSet(dbg, ed, filePath) {
  const tb = await toolbarButton(ed, '(^|\\s)사진(\\s|$)', 'image');
  if (!tb.best) throw Error('사진 버튼을 찾지 못했어요.');
  lastDiag.photoButtons = tb.candidates;
  await chrome.debugger.sendCommand(dbg, 'Page.enable');
  await chrome.debugger.sendCommand(dbg, 'Page.setInterceptFileChooserDialog', { enabled: true });
  let listener, timer;
  try {
    const node = new Promise((res, rej) => {
      listener = (src, method, p) => { if (src.tabId === ed.tabId && method === 'Page.fileChooserOpened') p?.backendNodeId ? res(p.backendNodeId) : rej(Error('사진 입력 요소를 찾지 못했어요.')); };
      chrome.debugger.onEvent.addListener(listener);
      timer = setTimeout(() => { const e = Error('사진 선택창이 열리지 않았어요.'); e.chooserTimeout = true; rej(e); }, 8000);
    });
    node.catch(() => {});                                                  // 클릭이 먼저 실패해도 늦게 나는 시간 초과가 오류로 새지 않게
    await click(dbg, tb.best);
    await chrome.debugger.sendCommand(dbg, 'DOM.setFileInputFiles', { files: [filePath], backendNodeId: await node });
  } finally {
    clearTimeout(timer); if (listener) chrome.debugger.onEvent.removeListener(listener);
    try { await chrome.debugger.sendCommand(dbg, 'Page.setInterceptFileChooserDialog', { enabled: false }); } catch (_) {}
  }
}
/* 실패했을 때 무엇이 가로막았는지 남겨 두는 진단 (알림·열린 창·올리는 중 표시) */
async function photoFailDiag(ed, before) {
  try {
    const fr = await run(ed.tabId, 'all', () => {
      const vis = n => n.getClientRects().length > 0 && n.getBoundingClientRect().width > 0;
      const pick = sel => [...document.querySelectorAll(sel)].filter(vis).slice(0, 8).map(n => (String(n.className || '').slice(0, 50) + ' | ' + (n.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60)));
      return { alerts: pick('[role="alert"],[role="status"],[class*="toast"],[class*="Toast"]'), layers: pick('[class*="layer"],[class*="popup"],[class*="modal"],[role="dialog"]'), busy: pick('[class*="upload"],[class*="progress"],[class*="loading"],[class*="spinner"]') };
    });
    lastDiag.photoFail = { imageCountBefore: before, frames: fr.map(f => f.result).filter(Boolean) };
  } catch (e) { lastDiag.photoFail = { err: String(e.message || e) }; }
}
async function uploadPhoto(dbg, ed, filePath) {
  const before = (await inspect(ed, 'read')).imageCount;
  for (let i = 1; ; i++) {
    try { await openChooserAndSet(dbg, ed, filePath); break; }
    catch (e) {
      if (!e.chooserTimeout || i >= CHOOSER_TRIES) { if (e.chooserTimeout) await photoFailDiag(ed, before); throw e; }
      (lastDiag.photoRetries = lastDiag.photoRetries || []).push('시도 ' + i + ' 선택창 안 열림 → ' + (i * 4) + '초 기다림');
      saveDiag();
      await wait(i * 4000);                                                // 앞 사진 업로드가 끝나길 기다림 (4초 → 8초 → 12초)
      if (await layer(ed, 'exists')) await closeLayer(dbg, ed);            // 가로막는 창이 떠 있으면 닫음
      if ((await inspect(ed, 'read')).imageCount > before) { await wait(400); return; }   // 그 사이 사진이 들어갔다면 다시 올리지 않음
    }
  }
  for (let t = 0; t < 60; t++) { await wait(300); if ((await inspect(ed, 'read')).imageCount > before) { await wait(400); return; } }
  throw Error('사진을 보냈지만 본문에 들어간 것을 확인하지 못했어요.');
}

/* 사진·카드 다음 줄로 커서 이동 */
async function caretAfterLast(dbg, ed) {
  const st = await inspect(ed, 'after-last');
  if (!st.point) throw Error('사진 다음 입력 위치를 찾지 못했어요.');
  await click(dbg, st.point);
  if (!st.hasNext) {
    await key(dbg, 'ArrowRight', 'ArrowRight', 39); await enter(dbg); await wait(350);
    const again = await inspect(ed, 'after-last');
    if (!again.hasNext) throw Error('사진 아래에 글 입력 줄을 만들지 못했어요.');
    await click(dbg, again.point);
  }
}

// 장소·링크 창: 창 안에서만 검색 → 첫 결과 선택 → [확인]. 실패하면 창을 확실히 닫고, 닫히지 않으면 전체를 멈춥니다.
function layerAction(action, query) {
  const kkPoint = n => { n.scrollIntoView({ block: 'nearest' }); const b = n.getBoundingClientRect(); let x = b.left + Math.min(b.width / 2, 160), y = b.top + Math.min(b.height / 2, 20), ok = true; try { let w = window; while (w !== w.top) { const f = w.frameElement; if (!f) { ok = false; break; } const r = f.getBoundingClientRect(); x += r.left; y += r.top; w = w.parent; } } catch (e) { ok = false; } return { x: Math.round(x), y: Math.round(y), width: Math.round(b.width), height: Math.round(b.height), offsetKnown: ok }; };
  const vis = n => n && n.getClientRects().length && n.getBoundingClientRect().width > 0;
  const txt = n => (n.innerText || n.value || n.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
  // 화면에 떠 있는 창: [확인] 버튼과 입력칸을 함께 가진 가장 작은 영역 (편집 본문 밖)
  const okBtns = [...document.querySelectorAll('button')].filter(b => vis(b) && /^확인$/.test(txt(b)) && !b.closest('.se-main-container,.se-documentTitle'));
  let layer = null, area = Infinity;
  for (const b of okBtns) {
    let n = b.parentElement;
    while (n && n !== document.body) {
      if (n.querySelector('input[type="text"],input:not([type]),input[type="search"]')) {
        const r = n.getBoundingClientRect();
        // 툴바·본문을 품은 큰 영역은 '창'이 아님 (이걸 잘못 잡으면 툴바 버튼을 누르게 됨)
        const tooBig = r.width * r.height > innerWidth * innerHeight * 0.7;
        const hasChrome = n.querySelector('.se-toolbar,[class*="toolbar"],.se-main-container,.se-documentTitle');
        if (!tooBig && !hasChrome && r.width * r.height < area) { layer = n; area = r.width * r.height; }
        break;
      }
      n = n.parentElement;
    }
  }
  if (action === 'exists') return !!layer;
  if (!layer) return null;
  const input = [...layer.querySelectorAll('input[type="text"],input:not([type]),input[type="search"]')].find(vis);
  const ok = [...layer.querySelectorAll('button')].find(b => vis(b) && /^확인$/.test(txt(b)));
  if (action === 'input') {
    if (!input) return null;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(input, ''); input.dispatchEvent(new Event('input', { bubbles: true }));
    return kkPoint(input);
  }
  if (action === 'result') {
    // 검색 결과 목록에서 검색어가 들어간 첫 항목 (없으면 첫 항목)
    const norm = s => s.replace(/\s+/g, '').toLowerCase(), q = norm(query || '');
    const items = [...layer.querySelectorAll('li,[role="option"],[class*="item"],[class*="result"] > *')].filter(n => vis(n) && !n.closest('[class*="toolbar"]') && !n.querySelector('button[class*="toolbar"]') && n.getBoundingClientRect().height > 20 && n.getBoundingClientRect().height < 200 && !n.contains(input) && !n.contains(ok) && txt(n).length > 1 && !/검색 결과가 없|다시 검색/.test(txt(n)));
    const hit = items.find(n => norm(txt(n)).includes(q)) || items[0];
    return hit ? { pt: kkPoint(hit), text: txt(hit).slice(0, 60), count: items.length, empty: /검색 결과가 없/.test(txt(layer)) } : { pt: null, count: 0, empty: /검색 결과가 없/.test(txt(layer)) };
  }
  if (action === 'search') {
    const r0 = input.getBoundingClientRect();
    const b = [...layer.querySelectorAll('button,[role="button"],i,span[class*="search"],[class*="btn_search"]')].filter(vis).find(n => /검색|search/i.test(txt(n) + ' ' + n.className) || (Math.abs(n.getBoundingClientRect().top - r0.top) < 30 && n.getBoundingClientRect().width < 50 && !/close|닫기|취소/i.test(n.className + txt(n))));
    return b ? kkPoint(b) : null;
  }
  if (action === 'add') {
    const b = [...layer.querySelectorAll('button,a')].find(n => vis(n) && /^(\+|추가|선택|첨부)$/.test(txt(n)));
    return b ? kkPoint(b) : null;
  }
  if (action === 'ok') return ok && !ok.disabled && ok.getAttribute('aria-disabled') !== 'true' && !/disabled/.test(ok.className) ? kkPoint(ok) : null;
  if (action === 'close') {
    const x = [...layer.querySelectorAll('button')].find(n => vis(n) && /닫기|close|취소/i.test(txt(n) + ' ' + n.className));
    if (x) { x.click(); return true; }
    return false;
  }
}
async function layer(ed, action, query) {
  const r = await run(ed.tabId, 'all', layerAction, [action, query || '']);
  return r.map(f => f.result).find(v => v !== null && v !== undefined && v !== false) ?? null;
}
async function closeLayer(dbg, ed) {
  for (let i = 0; i < 3; i++) {
    if (!await layer(ed, 'exists')) return true;
    if (i === 0) await layer(ed, 'close'); else await escape(dbg);
    await wait(500);
  }
  return !await layer(ed, 'exists');
}
async function insertViaLayer(dbg, ed, labelRe, dataName, query, kind) {
  const before = (await inspect(ed, 'read')).mediaCount;
  const tb = await toolbarButton(ed, labelRe, dataName);
  lastDiag[kind + 'Buttons'] = tb.candidates;
  if (!tb.best) throw Error(kind + ' 버튼 없음');
  await click(dbg, tb.best);
  let input = null;
  for (let i = 0; i < 10 && !input; i++) { await wait(400); input = await layer(ed, 'input'); }
  if (!input) { await closeLayer(dbg, ed); throw Error(kind + ' 검색칸 없음'); }
  await click(dbg, input); await type(dbg, query); await wait(200); await enter(dbg);
  // 결과가 뜰 때까지 기다렸다가 첫 결과 선택
  let res = null;
  if (kind === '링크') {   // 링크는 목록 없이 미리보기만 뜸 → 결과 클릭 생략, 안 뜨면 돋보기
    await wait(1800);
    if (!await layer(ed, 'ok')) { const sb = await layer(ed, 'search'); if (sb) { await click(dbg, sb); await wait(2000); } }
  }
  else for (let i = 0; i < 12; i++) {
    await wait(500); res = await layer(ed, 'result', query); if (res?.pt) break;
    if (i === 5 || (res?.empty && i < 6)) { const sb = await layer(ed, 'search'); if (sb) { await click(dbg, sb); i = Math.max(i, 5); } }   // Enter로 검색이 안 되면 돋보기 클릭
  }
  lastDiag[kind + 'Result'] = res;
  if (res?.pt) { await click(dbg, res.pt); await wait(700); }
  const add = await layer(ed, 'add'); if (add) { await click(dbg, add); await wait(600); }
  let ok = null;
  for (let i = 0; i < 8 && !ok; i++) { ok = await layer(ed, 'ok'); if (!ok) await wait(400); }
  if (ok) { await click(dbg, ok); await wait(1200); }
  const inserted = (await inspect(ed, 'read')).mediaCount > before;
  if (!inserted || await layer(ed, 'exists')) {
    if (!await closeLayer(dbg, ed)) throw Object.assign(Error(kind + ' 창이 닫히지 않아 입력을 멈췄어요. 그 창을 닫고 새 글로 다시 시도해 주세요.'), { fatal: true });
    if (!inserted) throw Error(kind + ' 삽입 확인 실패' + (res?.empty ? ' (검색 결과 없음)' : ''));
  }
}

/* 홈페이지 링크 카드: 주소를 '붙여넣기'하면 네이버가 링크 카드로 바꿔줍니다 */
async function pasteLink(ed, url) {
  const before = (await inspect(ed, 'read')).mediaCount;
  await chrome.scripting.executeScript({ target: { tabId: ed.tabId, frameIds: [ed.frameId] }, world: 'MAIN', args: [url], func: u => {
    const t = document.activeElement || document.querySelector('.se-main-container');
    const dt = new DataTransfer(); dt.setData('text/plain', u); dt.setData('text/html', '<a href="' + u + '">' + u + '</a>');
    t.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  } });
  for (let i = 0; i < 12; i++) { await wait(500); if ((await inspect(ed, 'read')).mediaCount > before) return true; }
  return false;
}

/* 파일 선택창 없이: 페이지 안의 <input type=file>을 직접 찾아 파일을 넣음 (iframe 포함) */
async function listFileInputs(dbg) {
  const { root } = await chrome.debugger.sendCommand(dbg, 'DOM.getDocument', { depth: -1, pierce: true });
  const found = [];
  const walk = n => {
    if (!n) return;
    if (n.nodeName === 'INPUT') {
      const a = {}; for (let i = 0; i < (n.attributes || []).length; i += 2) a[n.attributes[i]] = n.attributes[i + 1];
      if ((a.type || '').toLowerCase() === 'file') found.push({ nodeId: n.nodeId, accept: a.accept || '', cls: a.class || '', name: a.name || '', id: a.id || '' });
    }
    (n.children || []).forEach(walk); if (n.contentDocument) walk(n.contentDocument); (n.shadowRoots || []).forEach(walk);
  };
  walk(root);
  return found;
}
const inputKey = f => [f.accept, f.cls, f.name, f.id].join('|');
/* 동영상 칸에만 파일을 넣습니다.
   before(= 동영상 버튼을 누르기 전 목록)를 주면, 그 뒤에 새로 생긴 칸만 사용합니다 (사진 칸에 잘못 넣는 것 방지) */
async function setFileByInput(dbg, filePath, before) {
  const found = await listFileInputs(dbg);
  lastDiag.fileInputs = found.map(f => inputKey(f)).slice(0, 20);
  const videoish = found.filter(f => /video|mp4|mov|avi|wmv|mkv|동영상/i.test(f.accept + ' ' + f.cls + ' ' + f.name + ' ' + f.id));
  let pick = videoish.pop();
  if (!pick && before) {
    const seen = new Set(before.map(inputKey));
    pick = found.filter(f => !seen.has(inputKey(f))).pop();   // 동영상 창이 뜬 뒤에 새로 생긴 칸
  }
  if (!pick) return false;
  await chrome.debugger.sendCommand(dbg, 'DOM.setFileInputFiles', { files: [filePath], nodeId: pick.nodeId });
  lastDiag.videoInputUsed = inputKey(pick);
  return true;
}

/* (참고) 네이버 본문은 동영상 끌어다 놓기를 지원하지 않아 사용하지 않습니다 */
async function dropFileIntoBody(dbg, ed, filePath, mimeType) {
  const b = await inspect(ed, 'body');
  const pt = b.point || (await inspect(ed, 'after-last')).point;
  if (!pt || !pt.offsetKnown) return false;
  const name = String(filePath).split(/[\\/]/).pop();
  const data = { items: [{ mimeType, data: filePath, title: name }], files: [filePath], dragOperationsMask: 1 };
  const x = Math.round(pt.x), y = Math.round(pt.y);
  for (const type of ['dragEnter', 'dragOver', 'drop']) {
    await chrome.debugger.sendCommand(dbg, 'Input.dispatchDragEvent', { type, x, y, data, modifiers: 0 });
    await wait(200);
  }
  return true;
}


/* 업로드 창 안의 '동영상 추가 / 내 PC / 파일 선택' 같은 요소를 찾습니다.
   네이버는 이 버튼을 <button>이 아니라 <div>·<a>·<span>으로 만들기도 해서 모든 태그를 살핍니다. */
function findUploadSpot() {
  const RE = /^(동영상\s*(추가|선택|올리기|첨부)|파일\s*(추가|선택|첨부)|내\s*PC|사진\/?동영상|업로드|영상\s*추가)$/;
  const LOOSE = /동영상\s*추가|파일\s*선택|내\s*PC|업로드/;
  const vis = n => { const r = n.getBoundingClientRect(); return r.width > 4 && r.height > 4 && getComputedStyle(n).visibility !== 'hidden'; };
  const own = n => [...n.childNodes].filter(x => x.nodeType === 3).map(x => x.textContent).join('').replace(/\s+/g, ' ').trim();
  const pt = n => { const r = n.getBoundingClientRect(); let x = r.left + r.width / 2, y = r.top + r.height / 2, ok = true;
    try { let w = window; while (w !== w.top) { const f = w.frameElement; if (!f) { ok = false; break; } const q = f.getBoundingClientRect(); x += q.left; y += q.top; w = w.parent; } } catch (e) { ok = false; }
    return { x, y, width: r.width, height: r.height, offsetKnown: ok, tag: n.tagName, cls: String(n.className || '').slice(0, 50), text: (n.innerText || '').trim().slice(0, 24) }; };
  const all = [...document.querySelectorAll('button,a,label,div,span,li,p,strong,em,i')].filter(n => vis(n) && !n.closest('.se-main-container,.se-documentTitle,.se-toolbar'));
  let hit = all.filter(n => RE.test(own(n)));
  if (!hit.length) hit = all.filter(n => { const t = own(n); return t && t.length < 24 && LOOSE.test(t); });
  if (!hit.length) hit = all.filter(n => /upload|file_add|btn_add|add_video|se-video-add/i.test(String(n.className || '') + ' ' + (n.id || '')) && (n.innerText || '').length < 40);
  const area = n => { const r = n.getBoundingClientRect(); return r.width * r.height; };
  hit.sort((x, y) => area(x) - area(y));   // 가장 안쪽(작은) 요소부터 — 바깥 상자는 반응이 없을 수 있음
  return hit.slice(0, 4).map(pt);
}

/* 모든 화면(메인 + 열린 프레임/창)에서 그 요소를 찾아 눌러 봅니다 */
async function clickUploadSpot(dbg, ed, children) {
  const spots = (await run(ed.tabId, 'all', findUploadSpot).catch(() => [])).flatMap(f => (f.result || []));
  const usable = spots.filter(p => p.offsetKnown);
  if (usable.length) { lastDiag.videoSpot = usable[0]; await click(dbg, usable[0]); return 'main:' + usable[0].tag + '.' + usable[0].cls; }
  for (const c of children) {
    try {
      const r = await chrome.debugger.sendCommand(c.child, 'Runtime.evaluate', { returnByValue: true, userGesture: true,
        expression: '(() => { const f = ' + findUploadSpot.toString() + '; const s = f(); if (!s.length) return null; const el = document.elementFromPoint(s[0].x, s[0].y); if (el) { el.click(); return s[0].tag + "." + s[0].cls; } return null; })()' });
      const v = r && r.result && r.result.value;
      if (v) return 'frame:' + v;
    } catch (_) {}
  }
  if (spots.length) lastDiag.videoSpot = spots[0];
  return '';
}

/* 동영상: 툴바 [동영상] → 파일 선택 → 제목·태그 입력 → 완료 */
async function uploadVideo(dbg, ed, step) {
  const before = (await inspect(ed, 'read')).mediaCount;
  lastDiag.videoStep = ['start'];
  const tb = await toolbarButton(ed, '^동영상$', 'video');
  lastDiag.videoButtons = tb.candidates;
  if (!tb.best) throw Error('동영상 버튼 없음');
  // 동영상 업로드 창은 별도 프레임(iframe)일 수 있어서, 그 프레임까지 미리 붙잡아 파일 선택창을 가로챕니다.
  // (예전에는 이 프레임을 못 잡아 윈도우 파일 선택창이 그대로 열렸음)
  const children = [], popups = new Set(); let listener, resolveChooser, onTab;
  const cleanupTargets = async () => { chrome.debugger.onEvent.removeListener(listener); for (const id of popups) try { await chrome.debugger.detach({ tabId: id }); } catch (_) {} };
  const got = new Promise(res => { resolveChooser = res; });
  // 네이버가 동영상 업로드를 '새 창'으로 여는 경우도 붙잡음
  onTab = async tab => {
    if (tab.openerTabId !== ed.tabId) return;
    popups.add(tab.id);
    try { await chrome.debugger.attach({ tabId: tab.id }, '1.3'); await chrome.debugger.sendCommand({ tabId: tab.id }, 'Page.enable'); await chrome.debugger.sendCommand({ tabId: tab.id }, 'Page.setInterceptFileChooserDialog', { enabled: true }); children.push({ child: { tabId: tab.id }, url: 'popup', type: 'popup' }); } catch (e) { lastDiag.popupErr = String(e.message || e); }
  };
  chrome.tabs.onCreated.addListener(onTab);
  listener = (src, method, p) => {
    if (src.tabId !== ed.tabId && !popups.has(src.tabId)) return;
    if (method === 'Target.attachedToTarget') {
      const child = { tabId: ed.tabId, sessionId: p.sessionId };
      children.push({ child, url: (p.targetInfo && p.targetInfo.url || '').slice(0, 80), type: p.targetInfo && p.targetInfo.type });
      (async () => {
        try { await chrome.debugger.sendCommand(child, 'Page.enable'); await chrome.debugger.sendCommand(child, 'Page.setInterceptFileChooserDialog', { enabled: true }); } catch (_) {}
        try { await chrome.debugger.sendCommand(child, 'Runtime.runIfWaitingForDebugger'); } catch (_) {}
      })();
    }
    if (method === 'Page.fileChooserOpened' && p && p.backendNodeId) resolveChooser({ target: src.sessionId ? { tabId: src.tabId, sessionId: src.sessionId } : { tabId: src.tabId }, backendNodeId: p.backendNodeId });
  };
  chrome.debugger.onEvent.addListener(listener);
  try {
    await chrome.debugger.sendCommand(dbg, 'Page.enable');
    await chrome.debugger.sendCommand(dbg, 'Page.setInterceptFileChooserDialog', { enabled: true });
    try { await chrome.debugger.sendCommand(dbg, 'Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }); } catch (e) { lastDiag.autoAttachErr = String(e.message || e); }
    const inputsBefore = await listFileInputs(dbg).catch(() => []);
    await click(dbg, tb.best); lastDiag.videoStep.push('clicked');
    let chooser = await Promise.race([got, wait(4000).then(() => null)]);
    if (!chooser) {
      // 업로드 창이 먼저 뜨는 경우 — 창 안의 [동영상 추가]를 누르고, 동시에 파일칸을 직접 찾는 것도 계속 시도
      for (let i = 0; i < 30 && !chooser; i++) {
        const where = await clickUploadSpot(dbg, ed, children).catch(e => 'err:' + String(e.message || e).slice(0, 40));
        if (where) lastDiag.videoStep.push('spot@' + i + ':' + where);
        chooser = await Promise.race([got, wait(600).then(() => null)]);
        if (chooser) break;
        // 눌러도 선택창이 안 뜨면, 화면 안에 생긴 파일칸을 직접 채움
        if (await setFileByInput(dbg, step.filePath, inputsBefore).catch(() => false)) { lastDiag.videoStep.push('directMain@' + i); chooser = 'direct'; break; }
        for (const c of children) {
          if (await setFileByInput(c.child, step.filePath).catch(() => false)) { lastDiag.videoStep.push('directFrame@' + i); chooser = 'direct'; break; }
        }
      }
    }
    lastDiag.videoFrames = children.map(c => c.type + ' ' + c.url);
    if (chooser && chooser !== 'direct') {
      await chrome.debugger.sendCommand(chooser.target, 'DOM.setFileInputFiles', { files: [step.filePath], backendNodeId: chooser.backendNodeId }); lastDiag.videoStep.push('fileSet');
    } else if (!chooser) {
      // 선택창이 끝내 안 뜨면: 모든 프레임에서 동영상 업로드 칸(input type=file)을 직접 찾아 넣기
      let ok = await setFileByInput(dbg, step.filePath, inputsBefore);
      for (const c of children) if (!ok) ok = await setFileByInput(c.child, step.filePath).catch(() => false);
      if (!ok) {
        // 왜 못 찾았는지 알 수 있게, 열려 있는 각 화면의 상태를 기록합니다
        const info = [];
        for (const c of children) {
          try {
            const r = await chrome.debugger.sendCommand(c.child, 'Runtime.evaluate', { returnByValue: true, expression: "(()=>{const f=[...document.querySelectorAll('input[type=file]')];return{url:location.href.slice(0,120),files:f.length,accepts:f.map(n=>n.accept||'(없음)').slice(0,5),btns:[...document.querySelectorAll('button,label,[role=button]')].filter(n=>n.getClientRects().length).map(n=>(n.innerText||'').trim().slice(0,18)).filter(Boolean).slice(0,12)}})()" });
            info.push(r && r.result && r.result.value);
          } catch (e) { info.push({ err: String(e.message || e).slice(0, 60) }); }
        }
        try {
          const m = await run(ed.tabId, 'all', () => ({ url: location.href.slice(0, 120), files: document.querySelectorAll('input[type=file]').length, layers: [...document.querySelectorAll('[class*="layer"],[class*="popup"],[role=dialog]')].filter(n => n.getClientRects().length).map(n => (n.className || '').slice(0, 40)).slice(0, 6) }));
          info.push(...m.map(x => x.result).filter(Boolean));
        } catch (_) {}
        lastDiag.videoFrameInfo = info;
        throw Error('동영상 업로드 칸을 찾지 못함 (프레임 ' + children.length + '개 확인)');
      }
    }
  } finally {
    lastDiag.videoStep && lastDiag.videoStep.push('finally');
    chrome.tabs.onCreated.removeListener(onTab);
    try { await chrome.debugger.sendCommand(dbg, 'Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }); } catch (_) {}   // 연결은 유지(완료 버튼용), 새 프레임 멈춤만 해제
    for (const c of children) try { await chrome.debugger.sendCommand(c.child, 'Page.setInterceptFileChooserDialog', { enabled: false }); } catch (_) {}
    try { await chrome.debugger.sendCommand(dbg, 'Page.setInterceptFileChooserDialog', { enabled: false }); } catch (_) {}
  }
  return await videoFields(dbg, ed, step, children, cleanupTargets, before);
}

/* 업로드 후: 제목·태그 입력 → [완료] → 본문에 들어갔는지 확인 */
async function videoFields(dbg, ed, step, children, onCleanup, before) {
  if (before == null) before = 0;
  const pressDoneInFrames = async () => {
    for (const c of children) {
      try {
        const r = await chrome.debugger.sendCommand(c.child, 'Runtime.evaluate', { returnByValue: true, userGesture: true, expression: "(()=>{const own=n=>[...n.childNodes].filter(x=>x.nodeType===3).map(x=>x.textContent).join('').replace(/\\s+/g,' ').trim();const all=[...document.querySelectorAll('button,a,div,span,label')].filter(n=>n.getClientRects().length&&!n.disabled&&!/disabled/i.test(String(n.className||'')));const b=all.filter(n=>/^(동영상\\s*)?선택\\s*완료$/.test(own(n))).pop()||all.filter(n=>/^(완료|확인|등록|올리기)$/.test(own(n))).pop();if(b){b.click();return true}return false})()" });
        lastDiag.videoStep.push('done?' + JSON.stringify(r && r.result && r.result.value)); if (r && r.result && r.result.value) return true;
      } catch (_) {}
    }
    return false;
  };
  // 제목·설명·태그 칸 찾기 (자리표시 글자 기준)
  /* 동영상 업로드 창의 각 칸 위치를 찾습니다.
     네이버는 [완료]·[태그추가]를 <button>이 아닌 <div>·<a>로 만들기도 해서 모든 태그를 살핍니다. */
  const probe = () => {
    const vis = n => { const r = n.getBoundingClientRect(); return r.width > 2 && r.height > 2 && getComputedStyle(n).visibility !== 'hidden'; };
    const own = n => [...n.childNodes].filter(x => x.nodeType === 3).map(x => x.textContent).join('').replace(/\s+/g, ' ').trim();
    const txt = n => (n.innerText || '').replace(/\s+/g, ' ').trim();
    const off = n => { const r = n.getBoundingClientRect(); let x = r.left + Math.min(r.width / 2, 120), y = r.top + r.height / 2, ok = true;
      try { let w = window; while (w !== w.top) { const fr = w.frameElement; if (!fr) { ok = false; break; } const q = fr.getBoundingClientRect(); x += q.left; y += q.top; w = w.parent; } } catch (e) { ok = false; }
      return { x, y, width: r.width, height: r.height, offsetKnown: ok, tag: n.tagName, cls: String(n.className || '').slice(0, 40) }; };
    const dead = n => n.closest('.se-main-container,.se-documentTitle,.se-toolbar');
    const out = {};
    // 입력칸 — 자리표시 글자 / 라벨 글자로 구분
    for (const n of document.querySelectorAll('input,textarea,[contenteditable="true"]')) {
      if (!vis(n) || dead(n) || n.type === 'file') continue;
      const row = n.closest('tr,li,div');
      const ph = [n.placeholder, n.getAttribute('aria-label'), n.getAttribute('title'), row && row.previousElementSibling && txt(row.previousElementSibling), row && txt(row)].filter(Boolean).join(' ').slice(0, 80);
      if (/태그/.test(ph) && !out.tag) out.tag = off(n);
      else if (/제목/.test(ph) && !out.title) { out.title = off(n); out.titleValue = n.value || ''; }
      else if (/정보|설명/.test(ph) && !out.desc) out.desc = off(n);
    }
    // 누를 수 있는 것 — 태그 추가 / 완료
    const clicks = [...document.querySelectorAll('button,a,label,div,span,li,strong')].filter(n => vis(n) && !dead(n));
    const pick = re => { const hit = clicks.filter(n => re.test(own(n)) && !n.disabled && !/disabled/i.test(String(n.className || '')) && n.getAttribute('aria-disabled') !== 'true');
      hit.sort((x, y) => { const a2 = x.getBoundingClientRect(), b2 = y.getBoundingClientRect(); return a2.width * a2.height - b2.width * b2.height; }); return hit[0]; };
    const add = pick(/^태그\s*추가$/) || pick(/^#?\s*태그\s*(추가|입력)$/);
    if (add) out.tagAdd = off(add);
    const done = pick(/^(완료|확인|등록|올리기)$/);
    if (done) out.done = off(done);
    const selDone = pick(/^(동영상\s*)?선택\s*완료$/);   // 업로드가 끝난 뒤 나타나는 [동영상 선택 완료]
    if (selDone) out.selDone = off(selDone);
    return out;
  };
  const fields = async () => (await run(ed.tabId, 'all', probe))
    .map(f => f.result).reduce((a, b) => Object.assign(a, Object.fromEntries(Object.entries(b || {}).filter(([, v]) => v))), {});
  let f = {}; lastDiag.videoStep.push('fields');
  // 업로드가 끝나고 입력칸이 뜰 때까지 (최대 5분)
  for (let i = 0; i < 300 && !f.title && !f.tag && !f.done; i++) { await wait(1000); f = await fields().catch(e => { lastDiag.videoStep.push('fieldsErr:' + String(e.message || e).slice(0, 60)); return {}; }); }
  lastDiag.videoStep.push('fieldsDone');
  lastDiag.videoFields = Object.keys(f);
  // 제목
  if (f.title && f.title.offsetKnown) {
    await click(dbg, f.title);
    await chrome.debugger.sendCommand(dbg, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
    await chrome.debugger.sendCommand(dbg, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
    await type(dbg, step.title);
    lastDiag.videoStep.push('titleSet');
  }
  if (f.desc && step.desc && f.desc.offsetKnown) { await click(dbg, f.desc); await type(dbg, step.desc); }
  // 태그 — 입력칸이 없으면 [태그추가]를 먼저 누릅니다
  const tags = (step.tags || []).slice(0, 10);
  if (tags.length) {
    if (!f.tag && f.tagAdd && f.tagAdd.offsetKnown) {
      await click(dbg, f.tagAdd); await wait(700);
      f = Object.assign(f, await fields().catch(() => ({})));
      lastDiag.videoStep.push('tagAdd:' + (f.tag ? 'ok' : 'noInput'));
    }
    if (f.tag && f.tag.offsetKnown) {
      await click(dbg, f.tag);
      for (const t of tags) {
        await type(dbg, t); await enter(dbg); await wait(250);
        // 태그 하나를 넣으면 칸이 새로 그려지는 경우가 있어 위치를 다시 확인
        const nf = await fields().catch(() => ({}));
        if (nf.tag && nf.tag.offsetKnown && (Math.abs(nf.tag.x - f.tag.x) > 4 || Math.abs(nf.tag.y - f.tag.y) > 4)) { f.tag = nf.tag; await click(dbg, f.tag); }
      }
      lastDiag.videoStep.push('tagsSet:' + tags.length);
    } else lastDiag.videoStep.push('tagSkip');
  }
  // [완료] — 업로드가 끝나 눌릴 수 있을 때까지 최대 15분. 눌렀는데 창이 안 닫히면 다른 방법으로 다시 누릅니다.
  const jsPress = () => run(ed.tabId, 'all', () => {
    const vis = n => { const r = n.getBoundingClientRect(); return r.width > 8 && r.height > 8; };
    const t = n => (n.innerText || n.textContent || '').replace(/\s+/g, ' ').trim();
    const dlg = [...document.querySelectorAll('*')].some(n => n.children.length === 0 && /동영상\s*업로드/.test(n.textContent || '') && vis(n));
    const cands = [...document.querySelectorAll('button,a,[role="button"],div,span')].filter(n => vis(n) && t(n) === '완료' && !n.disabled && n.getAttribute('aria-disabled') !== 'true');
    // 가장 아래 오른쪽에 있는 [완료] (업로드 창의 완료 버튼)
    cands.sort((x, y) => { const a = x.getBoundingClientRect(), b = y.getBoundingClientRect(); return (b.top + b.left) - (a.top + a.left); });
    const n = cands.find(x => /^(BUTTON|A)$/.test(x.tagName) || x.getAttribute('role') === 'button') || cands[0];
    if (!n) return { dlg, found: false };
    const r = n.getBoundingClientRect();
    for (const ev of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) n.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
    return { dlg, found: true, tag: n.tagName, cls: String(n.className || '').slice(0, 40) };
  }).catch(() => []);
  let pressed = false;
  for (let i = 0; i < 900 && !pressed; i++) {
    f = await fields().catch(() => ({}));
    const dn = f.selDone && f.selDone.offsetKnown ? f.selDone : f.done;
    const attempt = (n) => { lastDiag.videoStep.push(n + '@' + i); };
    // 방법 1: 좌표 클릭
    if (dn && dn.offsetKnown) { await click(dbg, dn); attempt(f.selDone ? 'selDoneClick' : 'doneClick'); await wait(2500); }
    if ((await inspect(ed, 'read')).mediaCount > before) { pressed = true; break; }
    // 방법 2: 창 안에서 직접 클릭 이벤트
    const r2 = await jsPress(); const hit = r2.flatMap(x => x.result ? [x.result] : []).find(x => x.found);
    if (hit) { attempt('jsPress:' + hit.tag + '.' + hit.cls); await wait(2500); if ((await inspect(ed, 'read')).mediaCount > before) { pressed = true; break; } }
    // 방법 3: 프레임 안에서 눌러 보기
    if (children.length && await pressDoneInFrames()) { attempt('doneFrame'); await wait(2500); if ((await inspect(ed, 'read')).mediaCount > before) { pressed = true; break; } }
    await wait(1000);
  }
  const cleanup = async () => { if (onCleanup) await onCleanup(); };
  for (let i = 0; i < 30; i++) { await wait(1000); if ((await inspect(ed, 'read')).mediaCount > before) { await cleanup(); return; } }
  await cleanup();
  throw Error('동영상이 본문에 들어간 것을 확인하지 못함');
}


/* [동영상 창 구조 보기] — 동영상 버튼을 눌러 업로드 창을 띄운 뒤, 그 안이 어떻게 생겼는지 그대로 읽어옵니다.
   자동 업로드가 계속 실패할 때 원인을 찾기 위한 '읽기 전용' 기능입니다. 글을 바꾸지 않습니다. */
async function videoProbe() {
  const ed = await getEditor();
  if (!ed.ok) return { ok: false, error: '네이버 글쓰기 화면을 먼저 열어 주세요.' };
  const dbg = { tabId: ed.tabId }; const out = { at: new Date().toISOString(), frames: [] };
  const children = []; let listener;
  try {
    await chrome.debugger.attach(dbg, '1.3');
    listener = (src, method, p) => {
      if (src.tabId !== ed.tabId) return;
      if (method === 'Target.attachedToTarget') {
        const child = { tabId: ed.tabId, sessionId: p.sessionId };
        children.push({ child, url: (p.targetInfo && p.targetInfo.url || '').slice(0, 120), type: p.targetInfo && p.targetInfo.type });
        chrome.debugger.sendCommand(child, 'Runtime.runIfWaitingForDebugger').catch(() => {});
      }
    };
    chrome.debugger.onEvent.addListener(listener);
    try { await chrome.debugger.sendCommand(dbg, 'Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }); } catch (_) {}
    const tb = await toolbarButton(ed, '^동영상$', 'video');
    out.button = tb.candidates;
    if (!tb.best) return { ok: false, error: '동영상 버튼을 찾지 못했어요.', probe: out };
    await focusTab(ed.tab);
    await click(dbg, tb.best);
    await wait(4000);
    const DUMP = () => {
      const vis = n => { const r = n.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
      const own = n => [...n.childNodes].filter(x => x.nodeType === 3).map(x => x.textContent).join('').replace(/\s+/g, ' ').trim();
      const files = [...document.querySelectorAll('input[type=file]')].map(n => ({ accept: n.accept || '', cls: String(n.className || '').slice(0, 60), id: n.id || '', name: n.name || '', shown: !!n.getClientRects().length }));
      const layers = [...document.querySelectorAll('[class*="layer"],[class*="popup"],[class*="modal"],[role=dialog],[class*="video"]')]
        .filter(n => vis(n) && !n.closest('.se-main-container')).slice(0, 8)
        .map(n => ({ tag: n.tagName, cls: String(n.className || '').slice(0, 70), text: (n.innerText || '').replace(/\s+/g, ' ').slice(0, 160) }));
      const clickable = [...document.querySelectorAll('button,a,label,div,span,li,strong')]
        .filter(n => vis(n) && !n.closest('.se-main-container,.se-documentTitle,.se-toolbar') && own(n) && own(n).length < 26)
        .slice(0, 40).map(n => ({ tag: n.tagName, cls: String(n.className || '').slice(0, 50), text: own(n) }));
      const iframes = [...document.querySelectorAll('iframe')].map(n => ({ src: (n.src || '').slice(0, 120), cls: String(n.className || '').slice(0, 50), shown: !!n.getClientRects().length }));
      return { url: location.href.slice(0, 120), files, layers, clickable, iframes };
    };
    const main = await run(ed.tabId, 'all', DUMP).catch(e => [{ result: { err: String(e.message || e) } }]);
    out.frames.push(...main.map(f => f.result).filter(Boolean));
    for (const c of children) {
      try {
        const r = await chrome.debugger.sendCommand(c.child, 'Runtime.evaluate', { returnByValue: true, expression: '(' + DUMP.toString() + ')()' });
        out.frames.push(Object.assign({ childType: c.type, childUrl: c.url }, r && r.result && r.result.value));
      } catch (e) { out.frames.push({ childType: c.type, childUrl: c.url, err: String(e.message || e).slice(0, 80) }); }
    }
    // 창을 닫아 원래대로 되돌립니다
    await closeLayer(dbg, ed).catch(() => {});
    return { ok: true, probe: out, version: chrome.runtime.getManifest().version };
  } catch (e) {
    return { ok: false, error: String(e.message || e), probe: out };
  } finally {
    if (listener) chrome.debugger.onEvent.removeListener(listener);
    try { await chrome.debugger.sendCommand(dbg, 'Target.setAutoAttach', { autoAttach: false, waitForDebuggerOnStart: false, flatten: true }); } catch (_) {}
    try { await chrome.debugger.detach(dbg); } catch (_) {}
  }
}


/* [발행 창 구조 보기] — 글쓰기 화면의 [발행] 버튼을 눌러 발행 창(공개 설정·예약 등)을 띄운 뒤, 그 안의 구조를 읽어 옵니다.
   읽기만 합니다: 창 안의 [발행] 확정 버튼은 누르지 않고, 읽은 뒤 Esc로 닫습니다. */
async function publishProbe() {
  const ed = await getEditor();
  if (!ed.ok) return { ok: false, error: '네이버 글쓰기 화면을 먼저 열어 주세요.' };
  const dbg = { tabId: ed.tabId }; const out = { at: new Date().toISOString(), frames: [] };
  try {
    await chrome.debugger.attach(dbg, '1.3');
    await focusTab(ed.tab);
    const pubs = (await run(ed.tabId, 'all', src => {
      const kkPoint=n=>{n.scrollIntoView({block:'center',inline:'nearest'});const b=n.getBoundingClientRect();let x=b.left+b.width/2,y=b.top+Math.min(b.height/2,18),ok=true;try{let w=window;while(w!==w.top){const f=w.frameElement;if(!f){ok=false;break;}const r=f.getBoundingClientRect();x+=r.left;y+=r.top;w=w.parent;}}catch(e){ok=false;}return {x:Math.round(x),y:Math.round(y),width:Math.round(b.width),height:Math.round(b.height),offsetKnown:ok};};
      return [...document.querySelectorAll('button,[role="button"]')].filter(b => b.getClientRects().length && /^발행$/.test((b.innerText || '').replace(/\s+/g, ' ').trim())).map(n => kkPoint(n));
    }, [FRAME_OFFSET])).flatMap(f => f.result || []).filter(p => p.offsetKnown);
    out.publishButtons = pubs.length;
    if (pubs.length !== 1) return { ok: false, error: '위쪽 [발행] 버튼을 하나로 특정하지 못했어요 (' + pubs.length + '개).', probe: out };
    await click(dbg, pubs[0]); await wait(1800);
    const DUMP = () => {
      const vis = n => { const r = n.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
      const layers = [...document.querySelectorAll('[class*="layer"],[class*="popup"],[class*="modal"],[role=dialog],[class*="publish"]')].filter(n => vis(n) && !n.closest('.se-main-container'));
      const top = layers.filter(n => !layers.some(m => m !== n && m.contains(n)));   // 가장 바깥 창만
      return { url: location.href.slice(0, 100), layers: top.slice(0, 4).map(n => ({ cls: String(n.className || '').slice(0, 80), text: (n.innerText || '').replace(/\s+/g, ' ').slice(0, 400), html: n.outerHTML.replace(/\s+/g, ' ').replace(/ (style|data-[a-z-]+|aria-[a-z-]+)="[^"]*"/g, '').slice(0, 9000) })) };
    };
    const r = await run(ed.tabId, 'all', DUMP).catch(e => [{ result: { err: String(e.message || e) } }]);
    out.frames.push(...r.map(f => f.result).filter(x => x && (x.layers || x.err)));
    await escape(dbg); await wait(500);
    return { ok: true, probe: out, version: chrome.runtime.getManifest().version };
  } catch (e) {
    return { ok: false, error: String(e.message || e), probe: out };
  } finally { try { await chrome.debugger.detach(dbg); } catch (_) {} }
}


/* [발행 창 열기 → 카테고리 고르기 → (원하면) 예약 날짜·시간 맞추기]
   임시저장 뒤 [발행] 버튼으로 발행 창만 열고 카테고리·예약 시간만 맞춰 둡니다.
   창 안의 [발행] 확정 버튼은 절대 누르지 않아요 — 사장님이 보고 직접 누르게 창을 열어 둔 채로 끝냅니다. */
const PUB_POINT = `function kkAbs(n){n.scrollIntoView({block:'center',inline:'nearest'});const b=n.getBoundingClientRect();let x=b.left+b.width/2,y=b.top+b.height/2,ok=true;try{let w=window;while(w!==w.top){const f=w.frameElement;if(!f){ok=false;break;}const r=f.getBoundingClientRect();x+=r.left;y+=r.top;w=w.parent;}}catch(e){ok=false;}return {x:Math.round(x),y:Math.round(y),width:Math.round(b.width),height:Math.round(b.height),offsetKnown:ok};}`;
const pubRun = async (ed, fn, args = []) => (await run(ed.tabId, 'all', fn, [PUB_POINT, ...args])).flatMap(f => f.result ? [f.result] : []);

async function openPublishDialog(dbg, ed) {
  const pubs = (await run(ed.tabId, 'all', src => {
    const kkPoint=n=>{n.scrollIntoView({block:'center',inline:'nearest'});const b=n.getBoundingClientRect();let x=b.left+b.width/2,y=b.top+Math.min(b.height/2,18),ok=true;try{let w=window;while(w!==w.top){const f=w.frameElement;if(!f){ok=false;break;}const r=f.getBoundingClientRect();x+=r.left;y+=r.top;w=w.parent;}}catch(e){ok=false;}return {x:Math.round(x),y:Math.round(y),width:Math.round(b.width),height:Math.round(b.height),offsetKnown:ok};};
    return [...document.querySelectorAll('button,[role="button"]')].filter(b => b.getClientRects().length && /^발행$/.test((b.innerText || '').replace(/\s+/g, ' ').trim())).map(kkPoint);
  }, [FRAME_OFFSET])).flatMap(f => f.result || []).filter(p => p.offsetKnown);
  if (pubs.length !== 1) throw Error('위쪽 [발행] 버튼을 하나로 특정하지 못했어요 (' + pubs.length + '개)');
  await click(dbg, pubs[0]); await wait(1800);
}

async function pickCategory(dbg, ed, category) {
  const FIND = (src) => {
    function kkAbs(n){n.scrollIntoView({block:'center',inline:'nearest'});const b=n.getBoundingClientRect();let x=b.left+b.width/2,y=b.top+b.height/2,ok=true;try{let w=window;while(w!==w.top){const f=w.frameElement;if(!f){ok=false;break;}const r=f.getBoundingClientRect();x+=r.left;y+=r.top;w=w.parent;}}catch(e){ok=false;}return {x:Math.round(x),y:Math.round(y),width:Math.round(b.width),height:Math.round(b.height),offsetKnown:ok};}
    const vis = n => { const r = n.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
    const lab = [...document.querySelectorAll('*')].filter(n => vis(n) && n.children.length === 0 && (n.textContent || '').trim() === '카테고리')[0];
    if (!lab) return null;
    const L = lab.getBoundingClientRect();
    const cands = [...document.querySelectorAll('button,[role="button"],[role="combobox"],select,[class*="select"],[class*="dropdown"],[class*="category"]')]
      .filter(vis).map(n => ({ n, r: n.getBoundingClientRect() }))
      .filter(o => o.r.left > L.right - 4 && Math.abs((o.r.top + o.r.height / 2) - (L.top + L.height / 2)) < 36 && o.r.width > 80);
    cands.sort((a, b) => (a.r.width * a.r.height) - (b.r.width * b.r.height));
    const c = cands[0]; if (!c) return null;
    return Object.assign(kkAbs(c.n), { text: (c.n.innerText || c.n.value || '').replace(/\s+/g, ' ').trim().slice(0, 40) });
  };
  const found = (await pubRun(ed, FIND)).filter(p => p.offsetKnown);
  if (!found.length) throw Error('발행 창에서 카테고리 칸을 찾지 못했어요');
  const ctl = found[0];
  if (ctl.text.includes(category)) return { already: true, text: ctl.text };
  await click(dbg, ctl); await wait(700);
  const OPT = (src, cat) => {
    function kkAbs(n){n.scrollIntoView({block:'center',inline:'nearest'});const b=n.getBoundingClientRect();let x=b.left+b.width/2,y=b.top+b.height/2,ok=true;try{let w=window;while(w!==w.top){const f=w.frameElement;if(!f){ok=false;break;}const r=f.getBoundingClientRect();x+=r.left;y+=r.top;w=w.parent;}}catch(e){ok=false;}return {x:Math.round(x),y:Math.round(y),width:Math.round(b.width),height:Math.round(b.height),offsetKnown:ok};}
    const vis = n => { const r = n.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
    const norm = s => (s || '').replace(/\s+/g, ' ').trim();
    const nodes = [...document.querySelectorAll('li,[role="option"],button,a,span,div,label')].filter(n => vis(n) && norm(n.innerText).includes(cat) && norm(n.innerText).length <= cat.length + 14 && n.children.length <= 2);
    nodes.sort((a, b) => (norm(a.innerText) === cat ? 0 : 1) - (norm(b.innerText) === cat ? 0 : 1) || norm(a.innerText).length - norm(b.innerText).length);
    return nodes[0] ? Object.assign(kkAbs(nodes[0]), { text: norm(nodes[0].innerText).slice(0, 40) }) : null;
  };
  const opts = (await pubRun(ed, OPT, [category])).filter(p => p.offsetKnown);
  if (!opts.length) { await escape(dbg).catch(() => {}); throw Error("카테고리 목록에서 '" + category + "'를 찾지 못했어요"); }
  await click(dbg, opts[0]); await wait(800);
  const after = (await pubRun(ed, FIND))[0];
  if (!(after && after.text.includes(category))) throw Error('카테고리를 골랐지만 바뀐 것이 확인되지 않았어요(현재: ' + (after ? after.text : '?') + ')');
  return { text: after.text };
}

/* 예약 날짜·시간: [예약] 라디오 → 날짜(달력) → 시(時) → 분 */
async function setSchedule(dbg, ed, sch) {   // sch = {y,m,d,h,mi}
  const two = n => String(n).padStart(2, '0');
  const RADIO = (src) => {
    function kkAbs(n){n.scrollIntoView({block:'center',inline:'nearest'});const b=n.getBoundingClientRect();let x=b.left+b.width/2,y=b.top+b.height/2,ok=true;try{let w=window;while(w!==w.top){const f=w.frameElement;if(!f){ok=false;break;}const r=f.getBoundingClientRect();x+=r.left;y+=r.top;w=w.parent;}}catch(e){ok=false;}return {x:Math.round(x),y:Math.round(y),width:Math.round(b.width),height:Math.round(b.height),offsetKnown:ok};}
    const vis = n => { const r = n.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
    const norm = s => (s || '').replace(/\s+/g, ' ').trim();
    const lab = [...document.querySelectorAll('label,span,div')].filter(n => vis(n) && norm(n.innerText) === '예약' && n.children.length <= 1);
    lab.sort((a, b) => { const x = a.getBoundingClientRect(), y = b.getBoundingClientRect(); return x.width * x.height - y.width * y.height; });
    const hit = lab.filter(n => { const h = document.body.innerText.indexOf('발행 시간'); return h >= 0; })[0];
    if (!hit) return null;
    const input = hit.querySelector('input[type=radio]') || (hit.htmlFor && document.getElementById(hit.htmlFor)) || hit.closest('label')?.querySelector('input[type=radio]');
    return Object.assign(kkAbs(hit), { checked: input ? input.checked : null });
  };
  const radio = (await pubRun(ed, RADIO)).filter(p => p.offsetKnown)[0];
  if (!radio) throw Error("발행 창에서 [예약] 선택을 찾지 못했어요");
  if (radio.checked !== true) { await click(dbg, radio); await wait(900); }
  // 날짜·시·분 칸: '설정한 시간으로 예약 발행됩니다' 아래의 칸들
  const BOXES = (src) => {
    function kkAbs(n){n.scrollIntoView({block:'center',inline:'nearest'});const b=n.getBoundingClientRect();let x=b.left+b.width/2,y=b.top+b.height/2,ok=true;try{let w=window;while(w!==w.top){const f=w.frameElement;if(!f){ok=false;break;}const r=f.getBoundingClientRect();x+=r.left;y+=r.top;w=w.parent;}}catch(e){ok=false;}return {x:Math.round(x),y:Math.round(y),width:Math.round(b.width),height:Math.round(b.height),offsetKnown:ok};}
    const vis = n => { const r = n.getBoundingClientRect(); return r.width > 20 && r.height > 20; };
    const note = [...document.querySelectorAll('*')].filter(n => n.children.length === 0 && /설정한 시간으로 예약/.test(n.textContent || '') && n.getBoundingClientRect().width > 2)[0];
    if (!note) return [];
    const N = note.getBoundingClientRect();
    const els = [...document.querySelectorAll('input,select,button,[role="button"],[role="combobox"],div,span')]
      .filter(n => vis(n) && n.getBoundingClientRect().top > N.bottom - 2 && n.getBoundingClientRect().top < N.bottom + 90)
      .filter(n => /^(INPUT|SELECT|BUTTON)$/.test(n.tagName) || n.children.length === 0)
      .filter(n => /\d/.test((n.value || n.innerText || '').trim()) && (n.value || n.innerText || '').trim().length <= 14);
    els.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
    const uniq = []; for (const n of els) { const r = n.getBoundingClientRect(); if (!uniq.some(u => Math.abs(u.r.left - r.left) < 10)) uniq.push({ n, r }); }
    return uniq.map(u => Object.assign(kkAbs(u.n), { tag: u.n.tagName, text: String(u.n.value || u.n.innerText || '').trim() }));
  };
  const read = async () => (await pubRun(ed, BOXES)).filter(p => p.offsetKnown);
  let boxes = await read();
  if (boxes.length < 3) throw Error('예약 날짜·시간 칸을 찾지 못했어요(찾은 칸 ' + boxes.length + '개)');
  const cur = () => boxes.map(b => b.text).join(' | ');
  const info = { before: cur() };
  // 날짜 — 달력을 열어 해당 날짜 칸을 누릅니다
  const wantDate = sch.y + '. ' + two(sch.m) + '. ' + two(sch.d);
  if (boxes[0].text.replace(/\s+/g, '') !== wantDate.replace(/\s+/g, '')) {
    await click(dbg, boxes[0]); await wait(700);
    for (let t = 0; t < 14; t++) {
      const CAL = (src, y, m, d) => {
        function kkAbs(n){n.scrollIntoView({block:'center',inline:'nearest'});const b=n.getBoundingClientRect();let x=b.left+b.width/2,y=b.top+b.height/2,ok=true;try{let w=window;while(w!==w.top){const f=w.frameElement;if(!f){ok=false;break;}const r=f.getBoundingClientRect();x+=r.left;y+=r.top;w=w.parent;}}catch(e){ok=false;}return {x:Math.round(x),y:Math.round(y),width:Math.round(b.width),height:Math.round(b.height),offsetKnown:ok};}
        const vis = n => { const r = n.getBoundingClientRect(); return r.width > 4 && r.height > 4; };
        const body = document.body.innerText.replace(/\s+/g, ' ');
        const head = [...document.querySelectorAll('*')].filter(n => n.children.length === 0 && vis(n) && /^\d{4}\s*[.\-년]\s*\d{1,2}\s*월?$/.test((n.textContent || '').trim()))[0];
        let ym = null; if (head) { const mm = (head.textContent || '').match(/(\d{4})\D+(\d{1,2})/); ym = mm ? [+mm[1], +mm[2]] : null; }
        const cells = [...document.querySelectorAll('td button,td a,td span,td div,[role="gridcell"],[class*="day"] button,button[class*="day"]')].filter(n => vis(n) && n.children.length === 0 && (n.textContent || '').trim() === String(d) && !n.disabled && !/disabled|other|outside|prev|next/i.test(String(n.className || '') + String(n.closest('td,[role=gridcell]')?.className || '')));
        const nav = [...document.querySelectorAll('button,a,span')].filter(n => vis(n) && /next|다음|right|arrow-r/i.test(String(n.className || '') + (n.getAttribute('aria-label') || '') + (n.title || '')) && n.getBoundingClientRect().top < (head ? head.getBoundingClientRect().bottom + 30 : 9999) && n.getBoundingClientRect().bottom > (head ? head.getBoundingClientRect().top - 30 : 0));
        return { ym, cell: cells[0] ? kkAbs(cells[0]) : null, next: nav[0] ? kkAbs(nav[0]) : null };
      };
      const c = (await pubRun(ed, CAL, [sch.y, sch.m, sch.d])).filter(x => x.ym || x.cell)[0];
      if (!c) { info.calErr = '달력을 못 찾음'; break; }
      const same = c.ym && c.ym[0] === sch.y && c.ym[1] === sch.m;
      if (same || !c.ym) { if (c.cell && c.cell.offsetKnown) { await click(dbg, c.cell); await wait(600); } else info.calErr = '날짜 칸을 못 찾음'; break; }
      if (!c.next || !c.next.offsetKnown) { info.calErr = '다음 달 버튼을 못 찾음'; break; }
      await click(dbg, c.next); await wait(400);
    }
    boxes = await read();
  }
  // 시·분 — <select>면 값을 바꾸고, 아니면 눌러서 목록에서 고릅니다
  for (const [idx, want] of [[1, two(sch.h)], [2, two(sch.mi)]]) {
    const bx = boxes[idx]; if (!bx || bx.text === want) continue;
    if (bx.tag === 'SELECT') {
      await run(ed.tabId, 'all', (src, i, v) => { function kkAbs(n){n.scrollIntoView({block:'center',inline:'nearest'});const b=n.getBoundingClientRect();let x=b.left+b.width/2,y=b.top+b.height/2,ok=true;try{let w=window;while(w!==w.top){const f=w.frameElement;if(!f){ok=false;break;}const r=f.getBoundingClientRect();x+=r.left;y+=r.top;w=w.parent;}}catch(e){ok=false;}return {x:Math.round(x),y:Math.round(y),width:Math.round(b.width),height:Math.round(b.height),offsetKnown:ok};} const sel = [...document.querySelectorAll('select')].filter(n => n.getBoundingClientRect().width > 20); const s = sel[i - 1]; if (s) { const o = [...s.options].find(o => o.value === v || o.text.trim() === v); if (o) { s.value = o.value; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); } } }, [PUB_POINT, idx, want]);
    } else {
      await click(dbg, bx); await wait(500);
      const OP = (src, v) => { function kkAbs(n){n.scrollIntoView({block:'center',inline:'nearest'});const b=n.getBoundingClientRect();let x=b.left+b.width/2,y=b.top+b.height/2,ok=true;try{let w=window;while(w!==w.top){const f=w.frameElement;if(!f){ok=false;break;}const r=f.getBoundingClientRect();x+=r.left;y+=r.top;w=w.parent;}}catch(e){ok=false;}return {x:Math.round(x),y:Math.round(y),width:Math.round(b.width),height:Math.round(b.height),offsetKnown:ok};} const vis = n => { const r = n.getBoundingClientRect(); return r.width > 4 && r.height > 4; };
        const n = [...document.querySelectorAll('li,[role="option"],button,a,span,div')].filter(x => vis(x) && x.children.length === 0 && (x.textContent || '').trim() === v)
          .sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top)[0]; return n ? kkAbs(n) : null; };
      const o = (await pubRun(ed, OP, [want])).filter(p => p.offsetKnown)[0];
      if (o) { await click(dbg, o); await wait(500); }
      else { // 입력칸이면 직접 입력
        await click(dbg, bx); await chrome.debugger.sendCommand(dbg, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
        await chrome.debugger.sendCommand(dbg, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
        await type(dbg, want); await wait(300);
      }
    }
    await wait(300); boxes = await read();
  }
  boxes = await read();
  info.after = cur();
  const T = boxes.map(b => b.text.replace(/\s+/g, ''));
  info.ok = T[0] === wantDate.replace(/\s+/g, '') && T[1] === two(sch.h) && T[2] === two(sch.mi);
  return info;
}

async function openPublishPrepare(dbg, ed, category, sch) {
  const res = { steps: [] };
  await openPublishDialog(dbg, ed);
  if (category) {
    try { res.category = await pickCategory(dbg, ed, category); res.steps.push('카테고리 [' + category + ']'); }
    catch (e) { res.categoryError = String(e.message || e); }
  }
  if (sch) {
    try { res.schedule = await setSchedule(dbg, ed, sch); if (res.schedule.ok) res.steps.push('예약 ' + sch.y + '.' + sch.m + '.' + sch.d + ' ' + String(sch.h).padStart(2, '0') + ':' + String(sch.mi).padStart(2, '0')); else res.scheduleError = '예약 시간이 목표와 달라요(현재: ' + res.schedule.after + ')'; }
    catch (e) { res.scheduleError = String(e.message || e); }
  }
  return res;
}

/* 기존 글의 서식(회색 글씨·정렬·구분선·지도 카드·링크 카드)을 그대로 읽어오기 — 읽기만 합니다 */
async function captureTemplate() {
  const tabs = await chrome.tabs.query({ url: 'https://blog.naver.com/*' });
  for (const tab of tabs.sort((a, b) => Number(b.active) - Number(a.active))) {
    const r = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, world: 'MAIN', func: () => {
      const out = { href: location.pathname };
      const seen = new Set();
      const tryEditor = (ed, path) => {
        if (!ed || typeof ed !== 'object' || seen.has(ed)) return; seen.add(ed);
        const fns = [];
        for (let o = ed, d = 0; o && d < 4; o = Object.getPrototypeOf(o), d++) for (const k of Object.getOwnPropertyNames(o)) { try { if (typeof ed[k] === 'function') fns.push(k); } catch (_) {} }
        out.editors = out.editors || [];
        const entry = { path, methods: [...new Set(fns)].filter(k => /document|data|component|get|set|insert|load/i.test(k)).slice(0, 80) };
        for (const m of ['getDocumentData', 'getDocument', 'getData']) {
          try { if (typeof ed[m] === 'function') { const d = ed[m](); if (d) { entry.via = m; entry.data = JSON.parse(JSON.stringify(d)); break; } } } catch (e) { entry.err = String(e).slice(0, 120); }
        }
        out.editors.push(entry);
      };
      try { const SE = window.SmartEditor; if (SE) { out.hasSmartEditor = true; out.seKeys = Object.keys(SE).slice(0, 40); const eds = SE._editors || SE.editors; if (eds) for (const k of Object.keys(eds)) tryEditor(eds[k], 'SmartEditor._editors.' + k); } } catch (e) { out.seErr = String(e); }
      if (!out.editors) for (const k of Object.keys(window)) { try { const v = window[k]; if (v && typeof v === 'object' && typeof v.getDocumentData === 'function') tryEditor(v, 'window.' + k); } catch (_) {} }
      return out.hasSmartEditor || out.editors ? out : null;
    } }).catch(e => [{ result: { err: String(e) } }]);
    const hit = r.map(f => f.result).find(x => x && (x.editors || x.hasSmartEditor));
    if (hit) return { ok: true, template: hit, url: (tab.url || '').replace(/\?.*$/, '') };
  }
  return { ok: false, error: '네이버 글쓰기(또는 글 수정) 화면을 찾지 못했어요. 기존 글을 [수정]으로 열어 둔 뒤 다시 눌러 주세요.' };
}

/* 마지막 단계: 편집기의 문서 데이터를 기존 글 서식 그대로 다시 짭니다.
   (사진·지도·동영상은 네이버에 올라간 것을 그대로 쓰고, 글자·구분선·정렬·문의 안내만 서식대로) */
function restyleInPage(R) {
  try {
    const SE = window.SmartEditor; const eds = SE && SE._editors; if (!eds) return { ok: false, error: 'no editor api' };
    const ed = eds[Object.keys(eds)[0]]; if (!ed || typeof ed.getDocumentData !== 'function' || typeof ed.setDocumentData !== 'function') return { ok: false, error: 'no get/set' };
    const data = ed.getDocumentData(); const comps = data.document.components;
    const T = R.template, uid = () => 'SE-' + crypto.randomUUID(), lemon = R.mode === 'lemon';
    const clone = o => JSON.parse(JSON.stringify(o));
    const reId = o => { if (Array.isArray(o)) return o.map(reId); if (o && typeof o === 'object') { const n = {}; for (const k in o) n[k] = k === 'id' ? uid() : reId(o[k]); return n; } return o; };
    // 글줄 하나 → 글자 조각들. words(낱말 목록)와 em(강조 서식)이 있으면 그 낱말만 강조 서식으로
    const runs = (l, node, words, em) => {
      const plain = v => ({ '@ctype': 'textNode', id: uid(), style: clone(node), value: v });
      const ws = (words || []).filter(Boolean).sort((a, b) => b.length - a.length);
      if (!em || !ws.length || !l) return [plain(l)];
      const re = new RegExp('(' + ws.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'g');
      const out = []; let last = 0, m;
      while ((m = re.exec(l))) { if (m.index > last) out.push(plain(l.slice(last, m.index))); out.push({ '@ctype': 'textNode', id: uid(), style: clone(em), value: m[0] }); last = m.index + m[0].length; }
      if (last < l.length) out.push(plain(l.slice(last)));
      return out.length ? out : [plain(l)];
    };
    const text = (lines, node, para, words, em) => ({ '@ctype': 'text', id: uid(), layout: 'default', value: lines.map(l => ({ '@ctype': 'paragraph', id: uid(), style: clone(para), nodes: runs(l, node, words, em) })) });
    // 레몬: 가져온 글의 소제목(인용구) 모양에 공간 이름만 바꿔 넣기 — 구조가 예상과 다르면 null (글자 소제목으로 대신)
    const heading = name => {
      const H = T.heading && T.heading.proto; if (!H || !name) return null;
      const q = reId(clone(H)), p0 = Array.isArray(q.value) ? q.value[0] : null;
      if (!p0 || !Array.isArray(p0.nodes) || !p0.nodes[0]) return null;
      p0.nodes = [p0.nodes[0]]; p0.nodes[0].value = name; q.value = [p0]; return q;
    };
    const subVars = o => { if (typeof o === 'string') return o.replace(/\{apt\}/g, (R.vars && R.vars.apt) || '').replace(/\{region\}/g, (R.vars && R.vars.region) || ''); if (Array.isArray(o)) return o.map(subVars); if (o && typeof o === 'object') { const n = {}; for (const k in o) n[k] = k === 'id' ? o[k] : subVars(o[k]); return n; } return o; };
    const line = layout => ({ '@ctype': 'horizontalLine', id: uid(), align: 'center', layout });
    const title = comps.find(c => c['@ctype'] === 'documentTitle');
    const images = comps.filter(c => c['@ctype'] === 'image');
    const groups = comps.filter(c => c['@ctype'] === 'imageGroup').flatMap(g => g.images || []);
    const allImgs = images.concat(groups);
    const place = comps.find(c => c['@ctype'] === 'placesMap');
    const video = comps.find(c => c['@ctype'] === 'video');
    const need = 1 + R.groups.reduce((a, b) => a + b, 0);
    if (allImgs.length < need) return { ok: false, error: '사진 수 부족 ' + allImgs.length + '/' + need };
    if (title) { const p = title.title && title.title[0]; if (p) { p.style = { '@ctype': 'paragraphStyle', align: T.titleStyle.align }; (p.nodes || []).forEach(n => n.style = clone(T.titleStyle.node)); } }
    const out = [];
    if (title) out.push(title);
    const cover = clone(allImgs[0]); cover.represent = true; cover.align = cover.align || 'justify'; out.push(cover);
    if (!lemon) out.push(text(R.spec, T.specNode, T.specPara));
    if (place) { const p = clone(place); if (T.placeLayout) p.layout = T.placeLayout; out.push(p); }
    if (lemon) out.push(text(R.greeting, T.greetNode || T.bodyNode, T.greetPara || T.bodyPara, R.greetWords, T.greetEm));
    else out.push(text(R.greeting, T.bodyNode, T.bodyPara));
    if (T.afterGreetingLine) out.push(line(T.afterGreetingLine));
    let k = 1;
    R.groups.forEach((n, i) => {
      if (lemon && R.headings && R.headings[i]) { const hd = heading(R.headings[i]) || text([R.headings[i]], T.headNode || T.bodyNode, T.headPara || T.bodyPara); out.push(hd); }
      const imgs = allImgs.slice(k, k + n).map(clone); k += n;
      imgs.forEach(im => { im.represent = false; });
      if (n === 1) { imgs[0].align = imgs[0].align || 'justify'; out.push(imgs[0]); }
      else {
        // 네이버 콜라주: 높이가 같도록 가로 비율대로 폭(%)을 나눔 (2장씩 한 줄)
        for (let r = 0; r < imgs.length; r += 2) {
          const row = imgs.slice(r, r + 2), sum = row.reduce((s, im) => s + (im.originalWidth || 1) / (im.originalHeight || 1), 0);
          row.forEach(im => { delete im.align; im.widthPercentage = Math.round(((im.originalWidth || 1) / (im.originalHeight || 1)) / sum * 1000) / 10; });
        }
        out.push({ '@ctype': 'imageGroup', id: uid(), caption: null, contentMode: 'extend', layout: 'collage', images: imgs });
      }
      out.push(text(R.cards[i].split('\n').filter(Boolean), T.bodyNode, T.bodyPara, lemon ? R.bodyWords : null, lemon ? T.bodyEm : null));
    });
    for (const f of (T.footer || [])) out.push(lemon ? reId(subVars(clone(f))) : reId(clone(f)));
    if (video) { const v = clone(video); if (R.video) { v.mediaMeta = Object.assign({}, v.mediaMeta, { '@ctype': 'mediaMeta', title: R.video.title, description: R.video.title, tags: R.video.tags }); } out.push(v); }
    out.push(text([''], T.bodyNode, T.bodyPara));
    data.document.components = out;
    ed.setDocumentData(data);
    const after = ed.getDocumentData().document.components;
    return { ok: true, count: after.length, types: after.map(c => c['@ctype']).join(',') };
  } catch (e) { return { ok: false, error: String(e && e.message || e).slice(0, 200) }; }
}
async function restyle(ed, R) {
  const r = await chrome.scripting.executeScript({ target: { tabId: ed.tabId, allFrames: true }, world: 'MAIN', func: restyleInPage, args: [R] });
  const hit = r.map(f => f.result).find(x => x && x.ok) || r.map(f => f.result).find(x => x && x.error !== 'no editor api') || { ok: false, error: '편집기 API 없음' };
  lastDiag.restyle = hit;
  return hit;
}

/* ───────────── 글쓰기 실행 ───────────── */
async function fillAndSave(ed, title, plan, R, category, schedule) {
  const first = await inspect(ed, 'read');
  if (!first?.hasTitle) return { ok: false, stage: 'title', error: '제목 칸을 찾지 못했어요.' };
  if (clean(first.titleText) || clean(first.bodyText) || first.mediaCount)
    return { ok: false, stage: 'protect', error: '열려 있는 글쓰기 화면에 이미 내용이 있어서 덮어쓰지 않았어요. 빈 새 글을 열어 주세요.' };
  if (!await chrome.permissions.contains({ permissions: ['debugger'] })) return { ok: false, stage: 'permission', error: '확장 프로그램의 입력 권한(debugger)이 없어요. 확장을 다시 설치해 주세요.' };

  const dbg = { tabId: ed.tabId }; let attached = false; const skipped = [];
  try {
    await chrome.debugger.attach(dbg, '1.3'); attached = true;
    await focusTab(ed.tab);
    // 1) 제목 — 첫 글자를 넣고 제목 칸에 들어갔는지 확인한 뒤 나머지 입력
    const t = await inspect(ed, 'title'); await click(dbg, t.point);
    const chars = Array.from(title);
    await type(dbg, chars[0]); await wait(250);
    if (!clean((await inspect(ed, 'read')).titleText).startsWith(chars[0])) return { ok: false, stage: 'title', error: '제목 칸에 입력되지 않아 중단했어요.' };
    await type(dbg, chars.slice(1).join('')); await wait(200);
    if (clean((await inspect(ed, 'read')).titleText) !== clean(title)) return { ok: false, stage: 'title', error: '제목이 끝까지 입력되지 않았어요.' };
    // 2) 본문 첫 줄로 이동
    let b = await inspect(ed, 'body');
    if (!b.point) { await wait(800); b = await inspect(ed, 'body'); }
    if (!b.point) return { ok: false, stage: 'body', error: '본문 입력 위치를 찾지 못했어요.' };
    await click(dbg, b.point);
    // 3) 템플릿 순서대로
    let prev = 'start', uploaded = 0;
    let stepNo = 0;
    for (const step of plan) {
      stepNo++; progress(stepNo + '/' + plan.length + ' ' + step.type);
      if (step.type === 'text') {
        if (await layer(ed, 'exists') && !await closeLayer(dbg, ed)) return { ok: false, saved: false, stage: 'layer', error: '편집기 위에 열린 창이 있어 글 입력을 멈췄어요.' };
        if (prev === 'media') await caretAfterLast(dbg, ed);
        else if (prev === 'text') { await enter(dbg); await enter(dbg); }
        await typeLines(dbg, step.text); prev = 'text';
      } else if (step.type === 'divider') {
        if (prev === 'media') await caretAfterLast(dbg, ed); else if (prev === 'text') { await enter(dbg); await enter(dbg); }
        await type(dbg, '• • • • •'); prev = 'text';
      } else if (step.type === 'image') {
        if (prev === 'text') await enter(dbg);
        else if (prev === 'media') await caretAfterLast(dbg, ed);   // 콜라주 사진을 연달아 올릴 때
        try { await uploadPhoto(dbg, ed, step.filePath); }
        catch (e) { return { ok: false, saved: false, stage: 'photos', error: (uploaded + 1) + '번째 사진에서 멈췄어요: ' + e.message + ' (임시저장은 하지 않았어요)' }; }
        uploaded++; prev = 'media';
      } else if (step.type === 'video') {
        if (prev === 'text') await enter(dbg);
        try { await uploadVideo(dbg, ed, step); prev = 'media'; }
        catch (e) { lastDiag.videoError = String(e.message || e); skipped.push('동영상 — 임시저장 뒤 네이버 글에서 [동영상] 버튼으로 직접 올려 주세요 (' + e.message + ')'); await closeLayer(dbg, ed); }
      } else if (step.type === 'place' || step.type === 'link') {
        if (prev === 'text') await enter(dbg);
        const isPlace = step.type === 'place';
        if (!isPlace && await pasteLink(ed, step.url)) { prev = 'media'; continue; }
        try { await insertViaLayer(dbg, ed, isPlace ? '^(장소|지도)$' : '^링크$', isPlace ? 'map' : 'oglink', isPlace ? step.query : step.url, isPlace ? '장소' : '링크'); prev = 'media'; }
        catch (e) {
          if (e.fatal) return { ok: false, saved: false, stage: isPlace ? 'place' : 'link', error: e.message };
          skipped.push((isPlace ? '장소 카드' : '홈페이지 링크 카드') + ' (' + e.message + ')');
          const end = await inspect(ed, 'end'); if (end.point) await click(dbg, end.point);
          if (!isPlace) { await enter(dbg); await type(dbg, step.url); prev = 'text'; } // 링크는 주소 글자로라도 남김
        }
      }
    }
    await wait(500);
    // 4) 들어간 내용 확인 — 하나라도 빠지면 저장하지 않음
    const done = await inspect(ed, 'read'), body = clean(done.bodyText);
    const missing = plan.filter(s => s.type === 'text').map(s => clean(s.text).slice(0, 16)).filter(x => x && !body.includes(x));
    if (missing.length) return { ok: false, saved: false, stage: 'verify', error: '일부 문단이 확인되지 않아 임시저장하지 않았어요: "' + missing[0] + '…"' };
    if (done.imageCount < uploaded) return { ok: false, saved: false, stage: 'verify', error: '사진 수가 맞지 않아 임시저장하지 않았어요.' };
    // 4-2) 기존 글 서식 그대로 다시 짜기 (회색 글씨·구분선·정렬·문의 안내·링크 카드·콜라주)
    let styled = null;
    if (R && R.template) { styled = await restyle(ed, R); await wait(1200); if (!styled.ok) skipped.push('서식 적용 (' + styled.error + ')'); }
    // 5) '저장' 버튼 (발행 아님) — 정확히 하나일 때만 누름
    const saves = (await run(ed.tabId, 'all', src => {
      const kkPoint=n=>{n.scrollIntoView({block:'center',inline:'nearest'});const b=n.getBoundingClientRect();let x=b.left+b.width/2,y=b.top+Math.min(b.height/2,18),ok=true;try{let w=window;while(w!==w.top){const f=w.frameElement;if(!f){ok=false;break;}const r=f.getBoundingClientRect();x+=r.left;y+=r.top;w=w.parent;}}catch(e){ok=false;}return {x:Math.round(x),y:Math.round(y),width:Math.round(b.width),height:Math.round(b.height),offsetKnown:ok};};
      return [...document.querySelectorAll('button,[role="button"]')].filter(b => b.getClientRects().length && /^저장(\s*\d+)?$/.test((b.innerText || '').replace(/\s+/g, ' ').trim()) && !/발행|예약/.test((b.innerText || '') + (b.getAttribute('aria-label') || ''))).map(kkPoint);
    }, [FRAME_OFFSET])).flatMap(f => f.result || []).filter(p => p.offsetKnown);
    if (saves.length !== 1) return { ok: true, saved: false, skipped, message: '사진 ' + uploaded + '장과 글을 모두 넣었어요. 저장 버튼을 특정하지 못했으니 네이버에서 [저장]을 직접 눌러 주세요.' };
    await click(dbg, saves[0]); await wait(1800);
    const toast = (await run(ed.tabId, 'all', () => [...document.querySelectorAll('[role="status"],[role="alert"],[class*="toast"],[class*="Toast"]')].filter(x => x.getClientRects().length).map(x => (x.innerText || '').trim()).join(' '))).map(f => f.result).join(' ');
    const saved = /저장(되었|됐|완료)|임시.?저장/.test(toast);
    let catMsg = '';
    if ((category || schedule) && saved) {
      try {
        const pr = await openPublishPrepare(dbg, ed, category, schedule);
        lastDiag.publishPrep = pr;
        const parts = []; if (pr.steps.length) parts.push('발행 창에 ' + pr.steps.join(', ') + '을(를) 맞춰 두었어요');
        const errs = [pr.categoryError, pr.scheduleError].filter(Boolean);
        catMsg = ' ' + (parts.join('') || '발행 창을 열었어요') + (errs.length ? ' (자동으로 못 맞춘 것: ' + errs.join(' / ') + ' — 직접 맞춰 주세요)' : '') + '. 내용을 확인하시고 직접 [발행]을 눌러 주세요.';
      } catch (e) { catMsg = ' (발행 창 자동 설정 실패: ' + String(e.message || e) + ')'; }
    } else if (category || schedule) catMsg = ' (임시저장 확인이 안 돼 발행 창은 열지 않았어요)';
    return { ok: true, saved, skipped, message: saved ? '사진 ' + uploaded + '장과 글을 넣고 임시저장했어요.' + (catMsg || ' 네이버 임시저장 목록에서 확인해 주세요.') : '사진 ' + uploaded + '장과 글을 넣고 [저장]을 눌렀어요. 저장 완료 알림은 확인하지 못했으니 임시저장 목록을 확인해 주세요.' };
  } catch (e) {
    return { ok: false, stage: 'browser', error: String(e.message || e) };
  } finally { if (attached) try { await chrome.debugger.detach(dbg); } catch (_) {} }
}

/* ───────────── 네이버 검색광고 월간 검색량 ─────────────
   로그인된 '키워드 도구' 화면에 키워드를 넣고 [조회하기]를 누른 뒤,
   그 화면이 받아온 결과(JSON)를 그대로 읽습니다. 로그인 정보는 건드리지 않습니다. */
function findRows(obj, out = []) {
  if (Array.isArray(obj)) { for (const x of obj) findRows(x, out); return out; }
  if (!obj || typeof obj !== 'object') return out;
  const keys = Object.keys(obj);
  const kw = keys.find(k => /^relKeyword$|keyword$/i.test(k) && typeof obj[k] === 'string');
  const pc = keys.find(k => /pc.*(qc|cnt|count|search)/i.test(k)), mo = keys.find(k => /mobile.*(qc|cnt|count|search)/i.test(k));
  if (kw && (pc || mo)) out.push({ keyword: obj[kw], pc: pc ? obj[pc] : 0, mobile: mo ? obj[mo] : 0 });
  for (const k of keys) if (obj[k] && typeof obj[k] === 'object') findRows(obj[k], out);
  return out;
}
async function keywordVolume(keywords) {
  const list = [...new Set((keywords || []).map(k => String(k).replace(/\s+/g, '')).filter(Boolean))].slice(0, 40);
  if (!list.length) return { ok: false, error: '조회할 키워드가 없어요.' };
  const diag = { steps: [] }; lastDiag.keyword = diag;
  let [tab] = await chrome.tabs.query({ url: 'https://manage.searchad.naver.com/*' });
  if (!tab) {
    tab = await chrome.tabs.create({ url: SEARCHAD, active: true });
    await waitLoad(tab.id, 15000); tab = await chrome.tabs.get(tab.id);
  }
  diag.url = (tab.url || '').replace(/\?.*$/, '');
  if (/nid\.naver\.com|login/i.test(tab.url || '')) return { ok: false, error: '네이버 검색광고에 로그인되어 있지 않아요. 열린 창에서 로그인한 뒤 다시 눌러주세요.', diag };
  if (!/keyword-planner|keywordstool|tool\/keyword/i.test(tab.url || '')) {
    const cid = /customers\/(\d+)/.exec(tab.url || '')?.[1];
    if (!cid) { await focusTab(tab); return { ok: false, error: '검색광고 화면에서 광고 계정을 선택한 뒤([도구 → 키워드 도구]까지 열면 가장 확실해요) 다시 눌러주세요.', diag }; }
    await chrome.tabs.update(tab.id, { url: `https://manage.searchad.naver.com/customers/${cid}/tool/keyword-planner` });
    await waitLoad(tab.id, 15000); await wait(2500); tab = await chrome.tabs.get(tab.id);
    diag.url = (tab.url || '').replace(/\?.*$/, '');
  }
  const dbg = { tabId: tab.id }; let attached = false;
  const rows = new Map(); const pending = new Set(); let lastHit = 0;
  const add = list2 => { for (const r of list2) if (r.keyword) rows.set(String(r.keyword).replace(/\s+/g, '').toLowerCase(), r); };
  const listener = async (src, method, p) => {
    if (src.tabId !== tab.id) return;
    if (method === 'Network.responseReceived' && /json|text\/plain/i.test(p.response?.mimeType || '')) pending.add(p.requestId);
    if (method === 'Network.loadingFinished' && pending.has(p.requestId)) {
      pending.delete(p.requestId);
      try {
        const r = await chrome.debugger.sendCommand(dbg, 'Network.getResponseBody', { requestId: p.requestId });
        const text = r.base64Encoded ? decodeURIComponent(escape(atob(r.body))) : r.body;
        const found = findRows(JSON.parse(text));
        if (found.length) { add(found); lastHit = Date.now(); diag.jsonHits = (diag.jsonHits || 0) + 1; }
      } catch (_) {}
    }
  };
  try {
    await focusTab(tab);
    await chrome.debugger.attach(dbg, '1.3'); attached = true;
    chrome.debugger.onEvent.addListener(listener);
    await chrome.debugger.sendCommand(dbg, 'Network.enable');
    for (let i = 0; i < list.length; i += 5) {
      const chunk = list.slice(i, i + 5);
      // 키워드 입력칸: 화면에 보이는 textarea 중 가장 큰 것 (없으면 '키워드'가 붙은 입력칸)
      const box = (await run(tab.id, 'all', () => {
        const kkPoint=n=>{n.scrollIntoView({block:'center'});const b=n.getBoundingClientRect();let x=b.left+Math.min(b.width/2,120),y=b.top+Math.min(b.height/2,20),ok=true;try{let w=window;while(w!==w.top){const f=w.frameElement;if(!f){ok=false;break;}const r=f.getBoundingClientRect();x+=r.left;y+=r.top;w=w.parent;}}catch(e){ok=false;}return {x:Math.round(x),y:Math.round(y),width:Math.round(b.width),height:Math.round(b.height),offsetKnown:ok};};
        const vis = n => n.getClientRects().length && n.getBoundingClientRect().width > 60;
        const tas = [...document.querySelectorAll('textarea')].filter(vis).sort((a, b) => b.getBoundingClientRect().width * b.getBoundingClientRect().height - a.getBoundingClientRect().width * a.getBoundingClientRect().height);
        const ta = tas[0] || [...document.querySelectorAll('input[type="text"],input:not([type])')].filter(vis).find(n => /키워드/.test((n.placeholder || '') + (n.getAttribute('aria-label') || '')));
        const info = { textareas: tas.length, placeholders: [...document.querySelectorAll('textarea,input')].filter(vis).map(n => n.placeholder).filter(Boolean).slice(0, 6), buttons: [...document.querySelectorAll('button')].filter(vis).map(b => (b.innerText || '').trim()).filter(t => t && t.length < 12).slice(0, 25) };
        if (!ta) return { info };
        const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ta), 'value').set; set.call(ta, ''); ta.dispatchEvent(new Event('input', { bubbles: true }));
        return { info, pt: kkPoint(ta) };
      })).map(f => f.result).find(r => r && (r.pt || r.info.textareas || r.info.buttons.length)) || {};
      diag.page = box.info;
      if (!box.pt) return { ok: false, error: '키워드 도구의 입력칸을 찾지 못했어요. 검색광고에서 [도구 → 키워드 도구] 화면이 열려 있는지 확인해 주세요.', diag };
      await click(dbg, box.pt);
      await type(dbg, chunk.join('\n'));
      const btn = (await run(tab.id, 'all', () => {
        const b = [...document.querySelectorAll('button,[role="button"],a,input[type="button"],input[type="submit"]')].find(n => n.getClientRects().length && /^조회\s*하기$|^조회$/.test((n.innerText || n.value || '').trim()));
        if (!b) return null;
        const r = b.getBoundingClientRect(); let x = r.left + r.width / 2, y = r.top + r.height / 2, ok = true;
        try { let w = window; while (w !== w.top) { const f = w.frameElement; if (!f) { ok = false; break; } const q = f.getBoundingClientRect(); x += q.left; y += q.top; w = w.parent; } } catch (e) { ok = false; }
        return { x: Math.round(x), y: Math.round(y), width: r.width, height: r.height, offsetKnown: ok };
      })).map(f => f.result).find(Boolean);
      if (!btn) return { ok: false, error: '[조회하기] 버튼을 찾지 못했어요.', diag };
      const startedAt = Date.now(); await click(dbg, btn);
      for (let t = 0; t < 30 && lastHit < startedAt; t++) await wait(400);
      // 결과를 응답에서 못 읽었으면 화면의 결과 표에서 읽기
      if (lastHit < startedAt) {
        await wait(1500);
        const fromTable = (await run(tab.id, 'all', () => {
          const num = s => /^[<\d,\s.]+$/.test(s.trim()) && /\d/.test(s);
          const out = [];
          for (const tr of document.querySelectorAll('tr,[role="row"]')) {
            const cells = [...tr.querySelectorAll('td,th,[role="cell"],[role="gridcell"]')].map(c => (c.innerText || '').trim());
            for (let i = 0; i + 2 < cells.length; i++) if (cells[i] && !num(cells[i]) && /[가-힣A-Za-z]/.test(cells[i]) && cells[i].length < 40 && num(cells[i + 1]) && num(cells[i + 2])) { out.push({ keyword: cells[i], pc: cells[i + 1], mobile: cells[i + 2] }); break; }
          }
          return out;
        })).flatMap(f => f.result || []);
        diag.tableRows = fromTable.length;
        if (fromTable.length) { add(fromTable); lastHit = Date.now(); }
      }
      if (lastHit < startedAt) return { ok: false, error: '조회 결과를 읽지 못했어요. 검색광고 화면에 결과가 보이는지 확인해 주세요.', diag };
      await wait(700);
    }
    return { ok: true, rows: [...rows.values()].slice(0, 1500), diag };
  } catch (e) { return { ok: false, error: String(e.message || e), diag }; }
  finally {
    chrome.debugger.onEvent.removeListener(listener);
    if (attached) try { await chrome.debugger.detach(dbg); } catch (_) {}
  }
}
function waitLoad(tabId, ms) {
  return new Promise(res => {
    const t = setTimeout(done, ms);
    function done() { clearTimeout(t); chrome.tabs.onUpdated.removeListener(on); res(); }
    function on(id, info) { if (id === tabId && info.status === 'complete') done(); }
    chrome.tabs.onUpdated.addListener(on);
  });
}

/* 빈 글쓰기 화면을 자동으로 엽니다 (이미 열린 빈 화면이 있으면 그걸 사용) */
async function openEditor() {
  const found = await getEditor();
  if (found.ok) {
    const st = await inspect(found, 'read');
    if (!clean(st.titleText) && !clean(st.bodyText) && !st.mediaCount) return found;
  }
  const tab = await chrome.tabs.create({ url: WRITE_URL, active: true });
  for (let i = 0; i < 50; i++) {
    await wait(600);
    const t = await chrome.tabs.get(tab.id).catch(() => null);
    if (!t) return { ok: false, stage: 'editor', error: '글쓰기 창이 닫혔어요.' };
    if (/nid\.naver\.com/.test(t.url || '')) return { ok: false, stage: 'login', error: '네이버에 로그인되어 있지 않아요. 열린 창에서 로그인한 뒤 다시 눌러주세요.' };
    // '작성 중인 글이 있습니다' → 취소(새 글), 도움말 패널 → 닫기
    await run(tab.id, 'all', () => {
      const vis = n => n && n.getClientRects().length;
      for (const box of document.querySelectorAll('[class*="popup"],[class*="layer"],[role="dialog"]')) {
        if (!vis(box) || !/작성\s*중인\s*글/.test(box.innerText || '')) continue;
        const cancel = [...box.querySelectorAll('button')].find(b => /^취소$/.test((b.innerText || '').trim()));
        if (cancel) cancel.click();
      }
      const help = document.querySelector('.se-help-panel-close-button,[class*="help"] button[class*="close"]');
      if (vis(help)) help.click();
    }).catch(() => {});
    const ed = await getEditor();
    if (ed.ok && ed.tabId === tab.id) {
      const st = await inspect(ed, 'read').catch(() => null);
      if (st?.hasBody) { await wait(800); return ed; }
    }
  }
  return { ok: false, stage: 'editor', error: '글쓰기 화면이 열리지 않았어요. 네이버 로그인 상태를 확인해 주세요.' };
}

/* ───────────── 네이버 부동산 면적 읽기 (읽기만 해요) ─────────────
   열려 있는 네이버 부동산(단지) 탭의 글자를 가져와서 스튜디오가 면적(113.67Am² 같은 줄)을 찾게 합니다. */
async function readLand() {
  const tabs = await chrome.tabs.query({ url: ['https://new.land.naver.com/*', 'https://fin.land.naver.com/*', 'https://m.land.naver.com/*', 'https://land.naver.com/*'] });
  if (!tabs.length) return { ok: false, error: '열려 있는 네이버 부동산 탭을 못 찾았어요. 크롬에서 단지 페이지(면적 정보가 보이는 화면)를 연 채로 다시 눌러 주세요.' };
  tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  const tab = tabs[0];
  // 글자 + (2.10.31) 화면에 보이는 도면 그림 주소 후보. 읽기만 하고 클릭·입력은 하지 않아요.
  const res = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: () => {
    const OK = /^https:\/\/(?:landthumb-phinf|land-phinf|dbscthumb-phinf)\.pstatic\.net\/|^https:\/\/img\.land\.naver\.com\//;
    const images = [];
    try {
      for (const img of document.querySelectorAll('img')) {
        const url = img.currentSrc || img.src || ''; if (!OK.test(url)) continue;
        const r = img.getBoundingClientRect(), w = Math.max(img.naturalWidth || 0, Math.round(r.width)), h = Math.max(img.naturalHeight || 0, Math.round(r.height));
        if (w < 90 || h < 60) continue;                                   // 아이콘·작은 장식 제외
        images.push({ url, alt: String(img.alt || '').slice(0, 60), w, h, shown: r.width > 0 && r.height > 0, plan: /평면|도면|평형|floor|plan/i.test((img.alt || '') + ' ' + url) });
      }
    } catch (_) {}
    return { title: document.title || '', url: location.href, text: ((document.body && document.body.innerText) || '').slice(0, 300000), images };
  } });
  const parts = (res || []).map(r => r && r.result).filter(Boolean);
  if (!parts.length) return { ok: false, error: '네이버 부동산 페이지를 읽지 못했어요. 페이지를 새로고침한 뒤 다시 눌러 주세요.' };
  const main = parts.find(x => x.url === tab.url) || parts[0];
  const seen = new Set(), images = [];
  for (const im of parts.flatMap(x => x.images || [])) { if (seen.has(im.url)) continue; seen.add(im.url); images.push(im); }
  images.sort((a, b) => (b.plan - a.plan) || (b.shown - a.shown) || (b.w * b.h - a.w * a.h));   // 도면 같은 것 → 보이는 것 → 큰 것 순
  return { ok: true, title: main.title || tab.title || '', url: tab.url, text: parts.map(x => x.text).join('\n'), images: images.slice(0, 12) };
}

/* ───────────── 네이버 카페 글 주소 → 본문 글자 읽기 (시공 참고 글) ─────────────
   로그인된 이 크롬으로 글을 백그라운드 탭에 열어 글자만 읽고, 연 탭은 닫습니다 (카페는 로그인·가입 글이 많아 서버에서 직접 못 읽어요). */
const CAFE_HOST = /^(?:m\.)?cafe\.naver\.com$/;
const CAFE_MAX = 20000;
function cafeExtract() {
  const clean = t => String(t || '').replace(/​/g, '').replace(/[ \t ]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const txt = el => clean(el && el.innerText);
  const SEL = ['.se-main-container', '.article_viewer .content', '.ContentRenderer', '#tbody', '.article_viewer', '#postViewArea', '.NHN_Writer', '.se_component_wrap'];
  let body = '';
  for (const s of SEL) { try { const t = [...document.querySelectorAll(s)].map(txt).join('\n'); if (t.length > body.length) body = t; } catch (_) {} }
  const pick = ['.title_text', 'h3.title', '.ArticleTitle .title_text', '.tit-box .title', '.article_header .title', 'meta[property="og:title"]'];
  let title = '';
  for (const s of pick) { try { const el = document.querySelector(s); const t = el ? (el.content || txt(el)) : ''; if (t) { title = clean(t); break; } } catch (_) {} }
  const all = txt(document.body).slice(0, 40000);
  const imgs = body ? document.querySelectorAll('.se-main-container img, #tbody img, .article_viewer img').length : 0;
  // 글 속 이미지 — 공사범위 표 사진을 찾아요 (저장소 naver-blog-auto 와 같은 규칙: 대표사진 다음 사진 → 없으면 파일 이름에 '공사범위·시공내역'이 든 사진)
  const imgUrl = img => { const x = img.getAttribute('data-original') || img.getAttribute('data-src') || img.currentSrc || img.src; try { return new URL(x, document.baseURI).href; } catch (_) { return ''; } };
  const urlsIn = el => [...new Set([...(el ? el.querySelectorAll('img') : [])].map(imgUrl).filter(u => /^https:\/\/[^/]+\.pstatic\.net\//.test(u)))];
  let scope = [], scopeHow = '', images = [];
  try {
    const root = document.querySelector('.se-main-container') || document.querySelector('.article_viewer .content, .ContentRenderer, #tbody, .article_viewer');
    images = urlsIn(root).slice(0, 40);
    const comps = root ? [...root.querySelectorAll('.se-component')].filter(c => !c.parentElement || !c.parentElement.closest('.se-component')) : [];
    const second = comps.filter(c => c.matches('.se-image,.se-imageGroup'))[1];
    scope = urlsIn(second).slice(0, 1); if (scope.length) scopeHow = 'photo2';
    if (!scope.length) { const named = images.filter(u => { try { return /공사.*(?:범위|내역)|시공.*내역|interior.?plan/i.test(decodeURIComponent(new URL(u).pathname)); } catch (_) { return false; } }); scope = named.slice(0, 1); if (scope.length) scopeHow = 'name'; }
  } catch (_) {}
  return { url: location.href, top: window === window.top, title, body, all, imgs, scope, scopeHow, imageCount: images.length };
}
const cafeWall = f => {   // 본문 없이 안내 화면만 있을 때: 'login' | 'member' | ''
  const t = (f.all || '') + ' ' + (f.title || '');
  if (/(멤버|회원)(만|에게만)?\s*(볼|열람|읽)|카페\s*(멤버|회원)\s*(가입|만)|가입\s*후\s*(볼|이용)/.test(t) && (f.all || '').length < 1500) return 'member';
  if (/로그인/.test(t) && (f.all || '').length < 800) return 'login';
  return '';
};
async function readCafe(rawUrl) {
  let u; try { u = new URL(String(rawUrl || '').trim()); } catch (_) { return { ok: false, error: '주소 형식이 올바르지 않아요. 카페 글 주소(https://cafe.naver.com/…)를 그대로 붙여넣어 주세요.' }; }
  if (u.protocol !== 'https:' || !(CAFE_HOST.test(u.hostname) || u.hostname === 'naver.me')) return { ok: false, error: '네이버 카페 글 주소(cafe.naver.com)만 읽을 수 있어요.' };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let tab = null, opened = false;
  try {
    tab = await chrome.tabs.create({ url: u.href, active: false }); opened = true;
    const t0 = Date.now();
    // ① 페이지가 다 뜰 때까지 (최대 25초)
    while (Date.now() - t0 < 25000) { const t = await chrome.tabs.get(tab.id).catch(() => null); if (!t) return { ok: false, error: '탭이 닫혀서 읽지 못했어요. 다시 눌러 주세요.' }; if (t.status === 'complete') break; await sleep(400); }
    // ② 글이 그려질 때까지 기다리며 읽기 — 글자 수가 두 번 연속 같으면 끝 (최대 12초)
    let best = null, lastLen = -1, same = 0, lastAll = -1, sameAll = 0, finalUrl = u.href;
    for (let i = 0; i < 24; i++) {
      const t = await chrome.tabs.get(tab.id).catch(() => null); if (!t) break; finalUrl = t.url || finalUrl;
      if (/nid\.naver\.com\/nidlogin|nidlogin\.login/.test(finalUrl)) return { ok: false, login: true, error: '네이버에 로그인이 안 되어 있어요. 크롬에서 네이버에 로그인한 뒤 다시 눌러 주세요.' };
      const res = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: cafeExtract }).catch(() => []);
      const parts = (res || []).map(r => r && r.result).filter(Boolean);
      best = parts.slice().sort((a, b) => (b.body.length - a.body.length) || (b.all.length - a.all.length))[0] || best;
      const len = best ? (best.body.length || 0) : 0;
      if (best && !best.body && i >= 3 && cafeWall(best)) break;                       // 로그인·회원 전용 안내 화면이면 오래 기다리지 않고 바로 알려 줘요
      if (len >= 30 && len === lastLen) { if (++same >= 2) break; } else same = 0;
      const allLen = best ? best.all.length : 0;                                       // 본문 선택자가 안 맞는 페이지: 화면 글자가 3초 넘게 안 변하면 그대로 읽기
      if (best && !best.body && allLen >= 200 && allLen === lastAll) { if (++sameAll >= 4 && i >= 6) break; } else sameAll = 0;
      lastLen = len; lastAll = allLen; await sleep(500);
    }
    if (!best) return { ok: false, error: '카페 페이지를 읽지 못했어요. 주소가 맞는지, 크롬에서 직접 열리는지 확인해 주세요.' };
    let rough = false;
    if (!best.body) {
      const w = cafeWall(best);
      if (w === 'login') return { ok: false, login: true, error: '이 글은 로그인이 필요해요. 크롬에서 네이버(카페 가입한 계정)에 로그인한 뒤 다시 눌러 주세요.' };
      if (w === 'member') return { ok: false, login: true, error: '이 카페의 회원만 볼 수 있는 글이에요. 가입한 계정으로 크롬에 로그인돼 있는지 확인해 주세요.' };
      if (best.all.length < 200) return { ok: false, error: '글 본문을 찾지 못했어요. 글이 완전히 열린 뒤 다시 눌러 주세요. (그래도 안 되면 글을 복사해서 [시공 참고 글]에 붙여넣어 주세요)' };
      best = { ...best, body: best.all }; rough = true;                               // 본문 위치를 못 찾았으면 화면 글자를 통째로 (메뉴·댓글이 섞일 수 있어요)
    }
    let text = best.body.split('\n').map(l => l.trim()).filter((l, i, a) => l || (a[i - 1] && a[i - 1].trim())).join('\n');
    const cut = text.length > CAFE_MAX;
    return { ok: true, title: (best.title || '').slice(0, 120), url: finalUrl.replace(/#.*$/, ''), text: cut ? text.slice(0, CAFE_MAX) : text, chars: text.length, cut, imgs: best.imgs || 0, rough, scope: rough ? [] : (best.scope || []), scopeHow: rough ? '' : (best.scopeHow || ''), imageCount: best.imageCount || 0 };
  } catch (e) {
    return { ok: false, error: '카페 글을 읽다가 문제가 생겼어요: ' + String((e && e.message) || e).slice(0, 120) };
  } finally {
    if (opened && tab) chrome.tabs.remove(tab.id).catch(() => {});
  }
}

/* ───────────── 메시지 처리 ───────────── */
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (!sender.url?.startsWith('http://127.0.0.1:')) return false;
  (async () => {
    const a = msg?.action, p = msg?.payload || {};
    if (a === 'PING') return { ok: true, version: chrome.runtime.getManifest().version };
    if (a === 'KEYWORD_VOLUME') return keywordVolume(p.keywords);
    if (a === 'OPEN') {
      const ed = await getEditor(); if (ed.ok) { await focusTab(ed.tab); return { ok: true, message: '열려 있는 글쓰기 화면으로 이동했어요.' }; }
      await chrome.tabs.create({ url: HOME, active: true }); return { ok: true, message: '네이버 블로그를 열었어요. 로그인 후 [글쓰기]를 눌러 빈 새 글을 열어 주세요.' };
    }
    if (a === 'READ_LAND') return readLand();
    if (a === 'READ_CAFE') return readCafe(p.url);
    if (a === 'LAND_SEARCH' || a === 'LAND_SELECT' || a === 'LAND_DETAILS') return landHandle(a, p);
    if (a === 'SCHED_READ' || a === 'FILM_OPEN' || a === 'FILM_PHOTO' || a === 'FILM_CLOSE') return filmHandle(a, p);
    if (a === 'CAPTURE_TEMPLATE') return captureTemplate();
    if (a === 'VIDEO_PROBE') return videoProbe();
    if (a === 'PUBLISH_PROBE') return publishProbe();
    if (a === 'DIAG') {
      const saved = lastDiag.at ? null : (await chrome.storage.local.get('kkDiag')).kkDiag;
      return { ok: true, diag: saved || lastDiag, version: chrome.runtime.getManifest().version, restoredFromStorage: !!saved };
    }
    if (a === 'JOB') {
      if (job && job.id === p.id) return { ok: true, state: job.state, progress: job.progress, result: job.result };
      const st = (await chrome.storage.local.get('kkJob')).kkJob;
      if (st && st.id === p.id && st.state === 'done') return { ok: true, state: 'done', result: st.result };
      return { ok: true, state: 'lost' };
    }
    if (a === 'CHECK') {
      const ed = await getEditor(); if (!ed.ok) return { ok: true, message: '열린 글쓰기 화면은 없어요. 입력 버튼을 누르면 새 글쓰기 창을 자동으로 열어요.' };
      const st = await inspect(ed, 'read');
      const empty = !clean(st.titleText) && !clean(st.bodyText) && !st.mediaCount;
      return { ok: true, message: empty ? '✓ 빈 글쓰기 화면과 연결됐어요.' : '열린 글쓰기 화면에 내용이 있어요. 입력할 때는 새 글쓰기 창을 따로 열어요.' };
    }
    if (a === 'INSERT_SAVE') {
      const title = String(p.title || '').trim(), plan = Array.isArray(p.plan) ? p.plan : [];
      if (!title || !plan.length) return { ok: false, stage: 'prepare', error: '제목과 본문이 필요해요.' };
      if (plan.length > 120 || plan.some(s => !['text', 'image', 'place', 'link', 'divider', 'video'].includes(s.type) || ((s.type === 'image' || s.type === 'video') && !/^([A-Za-z]:\\|\/)/.test(String(s.filePath || '')))))
        return { ok: false, stage: 'prepare', error: '입력 데이터가 올바르지 않아요.' };
      if (job && job.state === 'running') return { ok: false, stage: 'busy', error: '이미 입력 중인 작업이 있어요. 끝날 때까지 기다려 주세요.' };
      lastDiag = { at: new Date().toISOString(), version: chrome.runtime.getManifest().version, steps: plan.map(x => x.type).join(',') }; saveDiag();
      const id = 'job' + Date.now();
      job = { id, state: 'running', progress: '시작', result: null };
      chrome.storage.local.set({ kkJob: { id, state: 'running' } }).catch(() => {});
      runJob({ title, plan, restyle: p.restyle }).then(out => {
        job.state = 'done'; job.result = out;
        chrome.storage.local.set({ kkJob: { id, state: 'done', result: out } }).catch(() => {});
      });
      return { ok: true, started: true, id };
    }
    return { ok: false, error: '지원하지 않는 작업이에요.' };
  })().then(respond).catch(e => respond({ ok: false, error: String(e?.message || e) }));
  return true;
});
