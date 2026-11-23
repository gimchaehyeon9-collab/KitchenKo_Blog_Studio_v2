/* 네이버 부동산(fin.land.naver.com) 단지 조회 — 크롬 확장 쪽 (읽기만 해요)
   스튜디오 화면이 보낸 요청을 받아서 백그라운드 탭에서 ① 단지 검색 ② 단지 상세 ③ 평형·타입별 면적·도면 주소를 읽어 돌려줍니다.
   조회가 끝나면 연 탭은 닫아요. (worker.js 에서 importScripts 로 불러옵니다 — places.js 가 먼저 불러와 있어야 해요)
   요청 이름: LAND_SEARCH(후보 찾기) · LAND_SELECT(후보 하나 골라 상세 읽기) · LAND_DETAILS(단지 주소로 상세 읽기, 타입 지정 가능) */
(function (root) {
  'use strict';
  const P = root.KKPlaces;
  const HOME = 'https://fin.land.naver.com/home';
  let sleep = ms => new Promise(r => setTimeout(r, ms));
  class LandError extends Error { constructor(msg, code) { super(msg); this.code = code || 'fail'; } }
  const fail = (msg, code) => new LandError(msg, code);

  /* ───── 단지 화면 안에서 실행되는 함수들 (직렬화돼서 화면으로 전달되므로 바깥 변수를 쓰면 안 돼요) ───── */
  const PG = {
    hasInput: () => !!document.querySelector('#header-search'),
    clickByText: (selector, text) => {
      const vis = n => n && n.getBoundingClientRect().width > 0;
      const el = [...document.querySelectorAll(selector)].find(b => vis(b) && ((b.innerText || '') + ' ' + (b.getAttribute('aria-label') || '')).includes(text));
      if (!el) return false; el.click(); return true;
    },
    setText: (selector, value) => {
      const el = document.querySelector(selector); if (!el) return false;
      el.focus();
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    // 검색창 아래 후보 목록을 읽습니다 (검색어가 입력창에 반영된 뒤의 결과만)
    readSearch: keyword => {
      const normalize = t => t.replace(/\s+/g, ' ').trim();
      const input = document.querySelector('#header-search'), root = input?.closest?.('[role="dialog"]') || input?.parentElement?.parentElement;
      const list = input?.value === keyword ? [...root?.querySelectorAll('button,[role="option"]') || []].filter(b => b.getBoundingClientRect().width > 0).map(b => ({ name: normalize(b.innerText), complexName: normalize((b.querySelector('[class*="__name"]') || b.querySelector('strong'))?.textContent || ''), address: normalize(b.querySelector('[class*="__address"],[class*="address"]')?.textContent || '') })).filter(x => x.complexName && x.address && /아파트|재건축|오피스텔|주상복합|연립|빌라|도시형생활주택/.test(x.name)) : [];
      return { list, empty: input?.value === keyword && /검색 결과가 없습니다/.test(root?.innerText || '') };
    },
    clickCandidate: label => {
      const root = document.querySelector('#header-search')?.parentElement?.parentElement;
      const b = [...root?.querySelectorAll('button') || []].find(b => b.getBoundingClientRect().width > 0 && b.innerText.replace(/\s+/g, ' ').trim() === label);
      if (!b) return false; b.click(); return true;
    },
    findLink: name => {
      const root = document.querySelector('main,[role="main"],#content') || document.body;
      return [...root.querySelectorAll('a[href*="/complexes/"]')].find(a => a.getBoundingClientRect().width > 0 && a.textContent.replace(/\s/g, '') === name.replace(/\s/g, ''))?.href;
    },
    here: () => ({ href: location.href, title: document.title || '', text: ((document.body && document.body.innerText) || '').replace(/\s+/g, ' ').slice(0, 300) }),
    detailsReady: () => Boolean(document.querySelector('img[alt*="평면"],input[type="radio"],[role="radio"]')) && /공급면적/.test((document.querySelector('main,[role="main"],#content,#container') || document.body).innerText),
    hasPlanOrRadio: () => Boolean(document.querySelector('img[alt*="평면"],input[type="radio"],[role="radio"]')),
    pickType: type => {
      const radios = [...document.querySelectorAll('label,[role="radio"]')];
      const el = radios.find(e => e.textContent.replace(/\s/g, '') === type.replace(/\s/g, ''));
      if (!el) return false; el.click(); return true;
    },
    readDetails: () => {
      const root = document.querySelector('main,[role="main"],#content,#container') || document.body;
      const headings = [...root.querySelectorAll('h2,h3')].map(e => e.innerText.trim()).filter(Boolean);
      const images = [...root.querySelectorAll('img')].filter(img => /평면|평형|floor|plan/i.test(img.alt + ' ' + img.src)).map(img => ({ label: img.alt || '도면', url: img.src || img.currentSrc })).filter(x => /^https?:/.test(x.url || ''));
      const types = [...root.querySelectorAll('label,[role="radio"],option')].map(e => e.innerText.trim()).filter(t => /^\d+(?:\.\d+)?[A-Z]?\s*(?:㎡|평)$/.test(t));
      const text = root.innerText; const supply = text.match(/공급면적\s*([\d.]+)([A-Z]?)㎡/), exclusive = text.match(/전용면적\s*([\d.]+)([A-Z]?)㎡/);
      const selected = [...root.querySelectorAll('label,[role="radio"]')].find(e => { const control = e.control || document.getElementById(e.htmlFor) || e.querySelector('input'); return control?.checked || e.getAttribute('aria-checked') === 'true'; });
      return { name: headings[0] || document.title, text: text.slice(0, 20000), images, types: [...new Set(types)], supplyArea: supply?.[1] || '', exclusiveArea: exclusive?.[1] || '', selectedType: selected?.textContent.replace(/\s/g, '') || (supply ? `${supply[1]}${supply[2]}㎡` : '') };
    }
  };

  /* ───── 탭 한 개를 다루는 도구 ───── */
  function makeCtx(tabId, diag, firstUrl) {
    const t0 = Date.now(); let pristine = !!firstUrl;   // 탭을 처음부터 이 주소로 열었으면 첫 이동은 다시 하지 않아요
    const note = s => { diag.push(((Date.now() - t0) / 1000).toFixed(1) + 's ' + s); };
    let lastErr = '';
    const ev = async (func, ...args) => {
      try { const r = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func, args }); return r && r[0] ? r[0].result : undefined; }
      catch (e) { lastErr = String((e && e.message) || e).slice(0, 140); return undefined; }   // 화면이 바뀌는 중이면 잠시 읽을 수 없어요 — 바깥 반복문이 다시 시도합니다
    };
    const waitLoad = async ms => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        const t = await chrome.tabs.get(tabId).catch(() => null);
        if (!t) throw fail('조회 탭이 닫혔어요. 다시 눌러 주세요.', 'closed');
        if (/nid\.naver\.com/.test(t.url || '')) throw fail('네이버 보안/로그인 화면이 나왔어요. 크롬에서 네이버를 한 번 열어 확인한 뒤 다시 눌러 주세요.', 'login');
        if (t.status === 'complete') return;
        await sleep(300);
      }
    };
    const goto = async url => {
      note('열기 ' + url.replace(/^https:\/\//, '').slice(0, 60));
      const before = await chrome.tabs.get(tabId).catch(() => null); if (!before) throw fail('조회 탭이 닫혔어요. 다시 눌러 주세요.', 'closed');
      if (pristine && url === firstUrl) pristine = false;
      else { pristine = false; await chrome.tabs.update(tabId, { url }); }
      // 이동이 시작될 때까지 잠깐 기다려요 (옛 화면의 '로딩 끝'을 새 화면으로 착각하지 않게)
      const t0 = Date.now();
      while (Date.now() - t0 < 3000) { const t = await chrome.tabs.get(tabId).catch(() => null); if (!t) throw fail('조회 탭이 닫혔어요. 다시 눌러 주세요.', 'closed'); if (t.status !== 'complete' || (t.url && before.url && t.url !== before.url)) break; await sleep(100); }
      await waitLoad(25000);
    };
    const waitFor = async (func, ms, what, ...args) => {
      const end = Date.now() + ms;
      do { if (await ev(func, ...args)) return true; await sleep(250); } while (Date.now() < end);
      throw fail(what + ' 화면을 찾지 못했어요.', 'timeout');
    };
    const click = async (selector, text, ms = 10000) => {
      const end = Date.now() + ms;
      do { if (await ev(PG.clickByText, selector, text)) return true; await sleep(250); } while (Date.now() < end);
      return false;
    };
    return { tabId, ev, goto, waitFor, click, note, snapshot: () => ev(PG.here), lastError: () => lastErr };
  }

  /* ───── ① 단지 후보 찾기 ───── */
  async function searchIn(c, query, region) {
    const keyword = String(query || '').trim().replace(/\s*(?:아파트|apt)$/i, '').replace(/\s+/g, ' ').trim();
    region = String(region || '').trim();
    if (!keyword) throw fail('아파트명을 입력해 주세요.', 'input');
    if (keyword.length > 100) throw fail('아파트명은 100자 이내로 입력해 주세요.', 'input');
    await c.goto(HOME);
    if (!await c.ev(PG.hasInput)) { await c.click('button', '단지, 주소, 지하철, 초등학교 검색'); }
    await c.waitFor(PG.hasInput, 18000, '네이버 부동산 검색창');
    let state = { list: [], empty: false }, search = keyword;
    for (search of P.complexQueries(keyword, region)) {
      await c.ev(PG.setText, '#header-search', search);
      const started = Date.now(), until = started + 12000;
      do {
        state = (await c.ev(PG.readSearch, search)) || { list: [], empty: false };
        state.list = state.list.filter(x => P.relatedPlace(keyword, x.complexName));
        if (state.list.some(x => P.regionMatches(region, x.address)) || state.empty && Date.now() - started >= 2000) break;
        await sleep(250);
      } while (Date.now() < until);
      c.note('검색 "' + search + '" → ' + state.list.length + '곳' + (state.empty ? ' (결과 없음)' : ''));
      if (state.list.some(x => P.regionMatches(region, x.address))) break;
    }
    const list = state.list;
    const regionTokens = region.split(/\s+/).filter(Boolean).map(P.addressKey), score = x => P.nameDistance(P.placeName(keyword), P.placeName(x.complexName)) - regionTokens.filter(t => P.addressKey(x.address).includes(t)).length;
    list.sort((a, b) => score(a) - score(b));
    const seen = new Set();
    const unique = list.filter(x => { if (seen.has(x.name)) return false; seen.add(x.name); return true; }).map(x => ({ ...x, label: x.name, suggested: P.placeName(x.complexName) !== P.placeName(keyword) }));
    if (!unique.length) throw state.empty ? fail('‘' + query + '’에 해당하는 단지를 네이버에서 찾지 못했어요. 아파트명과 차수를 확인해 주세요.', 'notfound') : fail('네이버 단지 검색 결과가 준비되지 않았어요. 잠시 후 다시 조회해 주세요.', 'timeout');
    return { keyword, search, list: unique };
  }

  /* ───── ② 단지 상세 (평형·타입별 면적 · 도면) ───── */
  function complexUrl(raw) {
    let u; try { u = new URL(String(raw || '').trim()); } catch (_) { throw fail('네이버 부동산 단지 상세 링크(https://fin.land.naver.com/complexes/…)를 넣어 주세요.', 'input'); }
    if (u.protocol !== 'https:' || !['fin.land.naver.com', 'new.land.naver.com'].includes(u.hostname) || !/^\/complexes\/\d+/.test(u.pathname)) throw fail('네이버 부동산 단지 상세 링크(https://fin.land.naver.com/complexes/…)를 넣어 주세요.', 'input');
    const id = /^\/complexes\/(\d+)/.exec(u.pathname)[1];
    return new URL('https://fin.land.naver.com/complexes/' + id);   // new.land 주소도 같은 단지 번호로 fin 화면에서 읽어요
  }
  const clean = s => String(s || '').replace(/\s/g, '');
  const detailsHref = raw => { const u = complexUrl(raw); const shown = u.href; u.searchParams.set('tab', 'complex-info'); return { shown, href: u.href }; };
  async function detailsIn(c, rawUrl, type) {
    type = String(type || '');
    const { shown, href } = detailsHref(rawUrl);
    await c.goto(href);
    await c.waitFor(() => document.querySelectorAll('button').length > 0, 18000, '네이버 부동산 단지');
    const started = Date.now(); let ready = false;
    while (Date.now() - started < 12000) {
      await c.ev(PG.clickByText, '[role="tab"]', '단지정보');
      ready = await c.ev(PG.detailsReady); if (ready) break; await sleep(250);
    }
    if (!ready) throw fail('단지정보 화면을 찾지 못했어요. 네이버 상세 링크를 확인하거나 도면을 직접 첨부해 주세요.', 'timeout');
    await c.waitFor(PG.hasPlanOrRadio, 18000, '평형·도면');
    let data = null; const baselineStarted = Date.now();
    do { await sleep(250); data = await c.ev(PG.readDetails); if (data && data.images.length && data.supplyArea && data.exclusiveArea) break; } while (Date.now() - baselineStarted < 10000);
    if (!data) throw fail('단지 정보를 읽지 못했어요. 다시 조회해 주세요.', 'timeout');
    const previousImages = JSON.stringify(data.images.map(img => img.url));
    const changedType = !!type && clean(data.selectedType) !== clean(type);
    if (type) { const picked = await c.ev(PG.pickType, type); if (!picked) throw fail('선택한 평형·타입을 찾지 못했어요. 네이버 화면을 확인해 주세요.', 'notype'); }
    const readStarted = Date.now(); let imagesUpdated = !changedType;
    do {
      await sleep(250); data = (await c.ev(PG.readDetails)) || data;
      imagesUpdated = !changedType || JSON.stringify(data.images.map(img => img.url)) !== previousImages;
      if (data.images.length && imagesUpdated && data.supplyArea && data.exclusiveArea && (!type || clean(data.selectedType) === clean(type) && Number(data.supplyArea) === parseFloat(type))) break;
    } while (Date.now() - readStarted < 10000);
    if (!data.supplyArea || !data.exclusiveArea || type && clean(data.selectedType) !== clean(type) || type && Number(data.supplyArea) !== parseFloat(type)) throw fail('선택한 타입의 면적 정보를 확인하지 못했어요. 다른 타입의 도면은 연결하지 않았어요. 다시 조회해 주세요.', 'timeout');
    if (!imagesUpdated) data.images = [];
    const firstLine = data.text.split('\n').find(line => /(?:시|군|구)\s.*(?:동|읍|면|로|길)/.test(line));
    c.note('상세 ' + (data.selectedType || '?') + ' · 도면 ' + data.images.length + '장');
    return { ...data, region: (firstLine || '').trim(), url: shown, notice: data.images.length ? '평형·타입별로 도면이 다릅니다. 선택한 타입과 면적을 확인해 주세요.' : '선택한 타입의 도면을 조회하지 못했어요. 다시 조회하거나 도면 파일을 직접 첨부해 주세요.' };
  }

  async function selectIn(c, p) {
    await searchIn(c, p.query, p.region);   // 후보 목록을 다시 띄웁니다 (후보 버튼은 화면에 그대로 남아 있지 않아요)
    const clicked = await c.ev(PG.clickCandidate, String(p.label || ''));
    if (!clicked) throw fail('검색 결과가 바뀌었어요. 단지를 다시 골라 주세요.', 'changed');
    const until = Date.now() + 12000; let url;
    do { url = await c.ev(PG.findLink, String(p.complexName || '')); if (url) break; await sleep(250); } while (Date.now() < until);
    if (!url) throw fail('단지 상세 주소를 확인하지 못했어요. 네이버 창에서 상세 링크를 복사해 직접 넣어 주세요.', 'timeout');
    return hooks.detailsIn(c, url, p.type || '');
  }
  const hooks = { detailsIn };   // (시험에서 바꿔 끼울 수 있게)

  /* ───── 실행: 한 번에 하나씩, 백그라운드 탭 → 안 되면 앞 탭으로 한 번 더 ───── */
  let lock = Promise.resolve();
  const exclusive = fn => { const run = lock.then(fn, fn); lock = run.catch(() => {}); return run; };
  async function attempt(work, active, firstUrl) {
    const diag = []; let tab = null, prev = null;
    try {
      if (active) { const [t] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []); prev = t || null; }
      tab = await chrome.tabs.create({ url: firstUrl, active: !!active });
      const c = makeCtx(tab.id, diag, firstUrl);
      try { return { ok: true, ...(await work(c)), diag: diag.join('\n') }; }
      catch (e) {
        const here = await c.snapshot().catch(() => null);
        if (here) diag.push('화면: ' + here.title + ' | ' + here.href.slice(0, 90) + ' | ' + here.text.slice(0, 160));
        else { const t = await chrome.tabs.get(tab.id).catch(() => null); diag.push('탭: ' + (t ? t.status + ' ' + String(t.url || t.pendingUrl || '').slice(0, 90) : '없음') + (c.lastError() ? ' | 읽기 오류: ' + c.lastError() : '')); }
        return { ok: false, error: String((e && e.message) || e), code: (e && e.code) || 'fail', diag: diag.join('\n') };
      }
    } catch (e) {
      return { ok: false, error: '조회 탭을 열지 못했어요: ' + String((e && e.message) || e).slice(0, 100), code: 'fail', diag: diag.join('\n') };
    } finally {
      if (tab) await chrome.tabs.remove(tab.id).catch(() => {});
      if (prev && prev.id != null) chrome.tabs.update(prev.id, { active: true }).catch(() => {});
    }
  }
  const run = (work, firstUrl) => exclusive(async () => {
    const first = await attempt(work, false, firstUrl);
    if (first.ok || first.code !== 'timeout') return first;
    // 백그라운드 탭에서는 화면이 덜 그려지는 경우가 있어서, 시간 초과일 때만 앞 탭으로 한 번 더 해 봅니다
    const second = await attempt(work, true, firstUrl);
    if (second.ok) return { ...second, foreground: true };
    return second.code === 'timeout' || second.code === 'fail' ? { ...second, diag: first.diag + '\n— 앞 탭으로 다시 —\n' + second.diag } : second;
  });

  function landHandle(action, p) {
    p = p || {};
    if (action === 'LAND_SEARCH') return run(c => searchIn(c, p.query, p.region), HOME);
    if (action === 'LAND_SELECT') return run(async c => ({ details: await selectIn(c, p) }), HOME);
    if (action === 'LAND_DETAILS') {
      let href; try { href = detailsHref(p.url).href; } catch (e) { return Promise.resolve({ ok: false, error: e.message, code: e.code || 'input', diag: '' }); }   // 주소가 틀리면 탭을 열지 않아요
      return run(async c => ({ details: await detailsIn(c, p.url, p.type) }), href);
    }
    return Promise.resolve({ ok: false, error: '지원하지 않는 작업이에요.' });
  }
  root.landHandle = landHandle;
  root.__land = { hooks, PG, makeCtx, searchIn, selectIn, detailsIn, detailsHref, complexUrl, attempt, run, setSleep: fn => { sleep = fn; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.__land;
})(typeof self !== 'undefined' ? self : this);
