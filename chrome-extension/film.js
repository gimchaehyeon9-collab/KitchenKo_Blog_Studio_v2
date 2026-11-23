/* 현장 일정(site-schedule.pages.dev) → 아인(total.lemon-house.kr) 촬영 사진 가져오기 — 크롬 확장 쪽 (읽기·내려받기만 해요, 아인에 아무것도 저장·수정하지 않아요)
   카페 공사전·중 화면이 보낸 요청을 받아서, 내 크롬(이미 로그인돼 있는 상태)의 백그라운드 탭에서 일정표와 촬영 사진을 읽어요.
   요청 이름:
     SCHED_READ  일정표(이번 달 + 지난달)에서 사진 링크가 있는 현장 목록을 읽어요 → { people, items }
     FILM_OPEN   현장 하나의 사진 화면을 열어 현장 주소와 사진 목록을 읽어요 → { tabId, addr, parsed, photos }
     FILM_PHOTO  열어 둔 화면에서 사진 한 장을 받아요 (base64) → { b64, type }
     FILM_CLOSE  열어 둔 탭을 닫아요
   로그인이 안 돼 있으면 그 탭을 앞으로 가져와서(닫지 않고) "로그인한 뒤 다시 눌러 주세요"라고 알려요. 비밀번호·이메일 코드는 건드리지 않아요.
   (worker.js 에서 importScripts 로 불러옵니다) */
(function (root) {
  'use strict';
  const SCHED_HOST = 'site-schedule.pages.dev';
  const FILM_HOST = 'total.lemon-house.kr';
  const SCHED_URL = 'https://' + SCHED_HOST + '/';
  const FILM_PATH = '/Film/Detail';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const cr = () => (typeof chrome !== 'undefined' ? chrome : root.chrome);

  /* ───── 화면 안에서 실행되는 함수들 (직렬화돼서 화면으로 전달되므로 바깥 변수를 쓰면 안 돼요) ───── */
  const PG = {
    // 일정표를 읽어요. 이번 달을 읽고, back 이 true 면 [‹] 를 눌러 지난달도 읽어요.
    sched: async back => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const readOnce = () => {
        const items = [];
        document.querySelectorAll('td.cell').forEach(c => {
          const a = c.querySelector('a.film'); if (!a) return;
          let u; try { u = new URL(a.href); } catch (_) { return; }
          if (u.hostname !== 'total.lemon-house.kr') return;
          const idx = u.searchParams.get('idx'), ft = u.searchParams.get('ftype');
          if (!/^\d{1,9}$/.test(idx || '') || !/^[12]$/.test(ft || '')) return;
          const tag = c.querySelector('.tag'), small = tag && tag.querySelector('small');
          const label = tag ? [].filter.call(tag.childNodes, n => n.nodeType === 3).map(n => n.textContent).join('').replace(/^[✓\s]+/, '').trim() : '';
          items.push({ date: String(c.dataset.date || ''), person: String(c.dataset.person || ''), label, note: small ? small.textContent.trim() : '', idx, ftype: Number(ft) });
        });
        return items;
      };
      // 표가 그려지고 일정 칸(.tag)이 채워질 때까지 기다려요 (최대 12초). 칸 수가 두 번 연속 같으면 다 된 거예요.
      const settle = async () => {
        let last = -1, same = 0;
        for (let i = 0; i < 48; i++) {
          const n = document.querySelectorAll('td.cell .tag').length;
          if (document.querySelector('td.cell') && n > 0) { if (n === last) { if (++same >= 2) return true; } else same = 0; last = n; }
          await wait(250);
        }
        return !!document.querySelector('td.cell');
      };
      const label = () => ((document.querySelector('.monthlabel') || {}).textContent || '').trim();
      if (!(await settle())) return { ok: false, error: '일정표를 찾지 못했어요. (사이트 화면이 바뀌었거나 아직 안 떴어요)' };
      const people = [].map.call(document.querySelectorAll('thead th'), h => h.textContent.trim()).filter(t => t && t !== '날짜');
      const months = [{ label: label(), items: readOnce() }];
      if (back) {
        try {
          const prev = [].find.call(document.querySelectorAll('button'), b => b.textContent.trim() === '‹');
          const before = label();
          if (prev) {
            prev.click();
            for (let i = 0; i < 16 && label() === before; i++) await wait(250);
            await settle();
            months.push({ label: label(), items: readOnce() });
          }
        } catch (_) { /* 지난달을 못 읽어도 이번 달은 돌려줘요 */ }
      }
      return { ok: true, people, months };
    },
    // 사진 화면에서 현장 주소와 사진 목록을 읽어요 (사진 번호·이름만 — 사진 자체는 PG.photo 로 한 장씩 받아요)
    film: async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < 48 && !document.querySelector('img.img-thumbnail'); i++) await wait(250);
      const imgs = [].slice.call(document.querySelectorAll('img.img-thumbnail'));
      const t = document.querySelector('table.table-sm');
      const names = t ? [].map.call(t.querySelectorAll('tr'), r => (r.children[0] ? r.children[0].textContent.trim() : '')).filter(n => /\.(jpe?g|png|webp|gif)$/i.test(n)) : [];
      const input = document.querySelector('#txtSearchClientList');
      const addr = ((input && input.value) || '').replace(/\s+/g, ' ').trim();
      const photos = imgs.map((im, i) => {
        const src = im.currentSrc || im.src || '';
        let base = ''; try { base = decodeURIComponent(src.split('?')[0].split('/').pop() || ''); } catch (_) { base = ''; }
        return { i, name: names.length === imgs.length ? names[i] : base };
      });
      return { ok: true, addr, photos };
    },
    // 사진 한 장을 같은 사이트 안에서 받아 base64 로 돌려줘요 (이미 로그인된 쿠키 사용)
    photo: async i => {
      const im = [].slice.call(document.querySelectorAll('img.img-thumbnail'))[i];
      if (!im) return { ok: false, error: '사진 번호를 찾지 못했어요.' };
      let u; try { u = new URL(im.currentSrc || im.src, location.href); } catch (_) { return { ok: false, error: '사진 주소를 읽지 못했어요.' }; }
      if (u.origin !== location.origin || !/^\/Upload\//i.test(u.pathname)) return { ok: false, error: '아인 사진 주소가 아니라서 받지 않았어요.' };
      const r = await fetch(u.href, { credentials: 'include' });
      if (!r.ok) return { ok: false, error: '사진을 받지 못했어요 (' + r.status + ')' };
      const buf = new Uint8Array(await r.arrayBuffer());
      if (!buf.length) return { ok: false, error: '빈 사진이에요.' };
      if (buf.length > 30 * 1024 * 1024) return { ok: false, error: '사진이 너무 커요 (30MB 초과).' };
      let s = ''; for (let k = 0; k < buf.length; k += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(k, k + 0x8000));
      return { ok: true, type: (r.headers.get('content-type') || 'image/jpeg').split(';')[0], bytes: buf.length, b64: btoa(s) };
    },
  };

  /* ───── 주소 → 시/도 · 구/시 · 동 · 아파트명 (카페 새 작업 칸에 미리 채우는 용도, 틀리면 화면에서 고쳐요) ───── */
  const SIDO = [
    [/^서울/, '서울'], [/^부산/, '부산'], [/^대구/, '대구'], [/^인천/, '인천'], [/^광주/, '광주'], [/^대전/, '대전'], [/^울산/, '울산'], [/^세종/, '세종'],
    [/^경기/, '경기'], [/^강원/, '강원'], [/^충청?북|^충북/, '충북'], [/^충청?남|^충남/, '충남'], [/^전라?북|^전북/, '전북'], [/^전라?남|^전남/, '전남'],
    [/^경상?북|^경북/, '경북'], [/^경상?남|^경남/, '경남'], [/^제주/, '제주'],
  ];
  function parseAddr(addr) {
    const out = { sido: '', gu: '', dong: '', apt: '' };
    const toks = String(addr || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    if (!toks.length) return out;
    let i = 0;
    const hit = SIDO.find(([re]) => re.test(toks[0]));
    if (hit) { out.sido = hit[1]; i = 1; }
    // 구/시/군: 'OO시 OO구' 처럼 두 단어면 합쳐요
    if (toks[i] && /[구시군]$/.test(toks[i])) {
      out.gu = toks[i]; i++;
      if (/시$/.test(out.gu) && toks[i] && /구$/.test(toks[i])) { out.gu += ' ' + toks[i]; i++; }
    }
    if (toks[i] && /(동|읍|면|가|리)$/.test(toks[i]) && !/^\(/.test(toks[i])) { out.dong = toks[i]; i++; }
    // 번지 같은 괄호 묶음 · 숫자 번지는 건너뛰어요
    const isNoise = t => /^\(.*\)$/.test(t) || /^\d+(-\d+)*$/.test(t);
    while (toks[i] && isNoise(toks[i])) i++;
    const apt = [];
    for (; i < toks.length; i++) {
      const t = toks[i];
      if (/^\d+(-\d+)*$/.test(t) || /^\d+동$/.test(t) || /^\d+호$/.test(t) || /^\(.*\)$/.test(t)) break;   // 동·호수가 나오면 거기서 끝
      apt.push(t);
    }
    out.apt = apt.join(' ').replace(/아파트$/, '').trim() || apt.join(' ');
    return out;
  }

  /* ───── 탭 다루기 ───── */
  async function waitComplete(tabId, ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const t = await cr().tabs.get(tabId).catch(() => null);
      if (!t) return null;
      if (t.status === 'complete') return t;
      await sleep(250);
    }
    return cr().tabs.get(tabId).catch(() => null);
  }
  const hostOf = url => { try { return new URL(url).hostname; } catch (_) { return ''; } };
  const isFilmTab = t => { try { const u = new URL(t.url); return u.hostname === FILM_HOST && u.pathname === FILM_PATH; } catch (_) { return false; } };
  const loginNeeded = (what, tab) => ({ ok: false, needLogin: true, error: what + ' 로그인이 안 돼 있어요. 방금 열린 크롬 탭에서 로그인한 뒤, 이 화면에서 다시 눌러 주세요.' });
  // 로그인 화면으로 보내졌을 때: 탭을 앞으로 가져와요 (닫지 않아요)
  async function showTab(tabId) { try { await cr().tabs.update(tabId, { active: true }); } catch (_) { /* 이미 닫힘 */ } }
  const closeTab = tabId => cr().tabs.remove(tabId).catch(() => {});

  async function schedRead(p) {
    let tab = null, keep = false;
    try {
      tab = await cr().tabs.create({ url: SCHED_URL, active: false });
      let t = await waitComplete(tab.id, 25000);
      if (!t) return { ok: false, error: '탭이 닫혀서 읽지 못했어요. 다시 눌러 주세요.' };
      // 로그인 화면(Cloudflare)으로 넘어가는 데 시간이 걸릴 수 있어요 — 잠깐 더 보고 판단해요
      for (let i = 0; i < 6 && hostOf(t.url) === SCHED_HOST && !(await hasCells(tab.id)); i++) { await sleep(500); t = await cr().tabs.get(tab.id).catch(() => t); }
      if (hostOf(t.url) !== SCHED_HOST) { keep = true; await showTab(tab.id); return loginNeeded('현장 일정 사이트(site-schedule.pages.dev)에', tab); }
      const res = await cr().scripting.executeScript({ target: { tabId: tab.id }, func: PG.sched, args: [p && p.back !== false] });
      const r = res && res[0] && res[0].result;
      if (!r) return { ok: false, error: '일정표를 읽지 못했어요.' };
      if (!r.ok) return r;
      const seen = new Set(), items = [];
      for (const m of r.months) for (const it of m.items) { if (seen.has(it.idx + ':' + it.ftype)) continue; seen.add(it.idx + ':' + it.ftype); items.push(it); }
      const people = r.people.length ? r.people : [...new Set(items.map(x => x.person))];
      return { ok: true, people, items, months: r.months.map(m => m.label) };
    } catch (e) {
      return { ok: false, error: '일정표를 읽다가 문제가 생겼어요: ' + String((e && e.message) || e).slice(0, 120) };
    } finally {
      if (tab && !keep) closeTab(tab.id);
    }
  }
  async function hasCells(tabId) {
    try { const r = await cr().scripting.executeScript({ target: { tabId }, func: () => !!document.querySelector('td.cell') }); return !!(r && r[0] && r[0].result); } catch (_) { return false; }
  }

  async function filmOpen(p) {
    const idx = String((p && p.idx) || ''), ft = String((p && p.ftype) || '');
    if (!/^\d{1,9}$/.test(idx) || !/^[12]$/.test(ft)) return { ok: false, error: '현장 번호가 올바르지 않아요.' };
    let tab = null, keep = false;
    try {
      tab = await cr().tabs.create({ url: 'https://' + FILM_HOST + FILM_PATH + '?idx=' + idx + '&ftype=' + ft + '&windowed=1', active: false });
      const t = await waitComplete(tab.id, 30000);
      if (!t) return { ok: false, error: '탭이 닫혀서 읽지 못했어요. 다시 눌러 주세요.' };
      if (!isFilmTab(t)) { keep = true; await showTab(tab.id); return loginNeeded('아인(total.lemon-house.kr)에', tab); }
      const res = await cr().scripting.executeScript({ target: { tabId: tab.id }, func: PG.film });
      const r = res && res[0] && res[0].result;
      if (!r || !r.ok) return { ok: false, error: '사진 화면을 읽지 못했어요.' };
      if (!r.photos.length) return { ok: false, error: '이 현장에는 올라온 사진이 없어요.' };
      keep = true;                                      // 사진을 다 받을 때까지 탭을 열어 둬요 (FILM_CLOSE 로 닫아요)
      return { ok: true, tabId: tab.id, addr: r.addr, parsed: parseAddr(r.addr), photos: r.photos };
    } catch (e) {
      return { ok: false, error: '사진 화면을 열다가 문제가 생겼어요: ' + String((e && e.message) || e).slice(0, 120) };
    } finally {
      if (tab && !keep) closeTab(tab.id);
    }
  }

  async function ownTab(p) {
    const id = Number(p && p.tabId);
    if (!Number.isInteger(id) || id < 0) return null;
    const t = await cr().tabs.get(id).catch(() => null);
    return t && isFilmTab(t) ? t : null;                 // 아인 사진 화면만 — 다른 탭은 건드리지 않아요
  }
  async function filmPhoto(p) {
    const t = await ownTab(p);
    if (!t) return { ok: false, error: '열어 둔 사진 화면이 닫혔어요. 현장을 다시 눌러 주세요.' };
    const i = Number(p.i);
    if (!Number.isInteger(i) || i < 0 || i > 400) return { ok: false, error: '사진 번호가 올바르지 않아요.' };
    try {
      const res = await cr().scripting.executeScript({ target: { tabId: t.id }, func: PG.photo, args: [i] });
      return (res && res[0] && res[0].result) || { ok: false, error: '사진을 받지 못했어요.' };
    } catch (e) { return { ok: false, error: '사진을 받다가 문제가 생겼어요: ' + String((e && e.message) || e).slice(0, 100) }; }
  }
  async function filmClose(p) {
    const t = await ownTab(p);
    if (t) await closeTab(t.id);
    return { ok: true };
  }

  function filmHandle(action, p) {
    if (action === 'SCHED_READ') return schedRead(p || {});
    if (action === 'FILM_OPEN') return filmOpen(p || {});
    if (action === 'FILM_PHOTO') return filmPhoto(p || {});
    if (action === 'FILM_CLOSE') return filmClose(p || {});
    return Promise.resolve({ ok: false, error: '지원하지 않는 작업이에요.' });
  }
  root.filmHandle = filmHandle;
  root.__film = { PG, parseAddr, schedRead, filmOpen, filmPhoto, filmClose, filmHandle };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.__film;
})(typeof self !== 'undefined' ? self : this);
