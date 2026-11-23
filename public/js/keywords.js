/* 키워드 추천 + 네이버 검색광고 월간 검색량
   검색량은 크롬 확장 프로그램이 '로그인된 검색광고 키워드도구' 화면에서 읽어옵니다.
   (안 될 때는 키워드도구에서 받은 CSV를 불러올 수 있어요) */
(() => {
'use strict';
const KK = window.KK;
const { $, esc, norm } = KK;
const CACHE_KEY = 'kk2-volume-cache';
let cache = KK.store.get(CACHE_KEY, {});          // norm(keyword) → {pc, mo, at}
let related = [];                                  // 조회 결과 중 아파트명이 들어간 연관 키워드

const num = v => { const s = String(v ?? '').replace(/[,\s]/g, ''); if (/^<\d+/.test(s)) return { n: 5, lt: true }; const n = Number(s); return { n: Number.isFinite(n) ? n : 0, lt: false }; };
const vol = k => cache[norm(k)];
const total = k => { const v = vol(k); return v ? v.pc + v.mo : -1; };
const fmt = v => v == null ? '-' : v.lt ? '<10' : v.n.toLocaleString('ko-KR');

function aptNames(apt) {
  const a = String(apt || '').replace(/\s+/g, '').replace(/아파트$/, '');
  if (!a) return [];
  const names = [a];
  const noPhase = a.replace(/\d+차$/, '');
  if (noPhase !== a && noPhase.length >= 4) names.push(noPhase);
  return names;
}
KK.keywordCandidates = s => {
  const names = aptNames(s.apt);
  const sufs = [...new Set([...KK.ITEMS.filter(i => s.items.includes(i.key)).flatMap(i => i.kw), '인테리어', '제작가구', '맞춤가구'])];
  return { names, combos: names.flatMap(n => sufs.map(x => n + ' ' + x)) };
};

function recommend(s) {
  const { names, combos } = KK.keywordCandidates(s);
  const best = list => list.slice().sort((a, b) => total(b) - total(a))[0];
  const known = list => list.filter(k => total(k) >= 0);
  return { A: known(names).length ? best(names) : names[0] || '', B: known(combos).length ? best(combos) : combos[0] || '' };
}

KK.renderKeywords = () => {
  const s = KK.state, box = $('kwTable');
  const { names, combos } = KK.keywordCandidates(s);
  if (!names.length) { box.innerHTML = '<p class="muted">아파트명을 입력하면 키워드 후보가 나와요.</p>'; return; }
  const kw = KK.keywords(s);
  const extra = related.filter(r => !names.concat(combos).some(k => norm(k) === norm(r))).slice(0, 8);
  const row = (k, group) => {
    const v = vol(k);
    return `<tr class="${norm(k) === norm(kw.A) || norm(k) === norm(kw.B) ? 'on' : ''}"><td>${esc(k)}</td><td>${v ? fmt(v.pcRaw ?? { n: v.pc }) : '-'}</td><td>${v ? fmt(v.moRaw ?? { n: v.mo }) : '-'}</td><td><b>${v ? (v.pc + v.mo).toLocaleString('ko-KR') : '미확인'}</b></td>
      <td><button type="button" class="tiny ${norm(k) === norm(kw.A) ? 'sel' : ''}" data-set="A" data-k="${esc(k)}">A</button><button type="button" class="tiny ${norm(k) === norm(kw.B) ? 'sel' : ''}" data-set="B" data-k="${esc(k)}">B</button></td></tr>`;
  };
  box.innerHTML = `<table class="kw"><thead><tr><th>키워드</th><th>PC</th><th>모바일</th><th>월 합계</th><th>지정</th></tr></thead>
    <tbody><tr class="grp"><td colspan="5">아파트명</td></tr>${names.map(k => row(k)).join('')}
    <tr class="grp"><td colspan="5">아파트명 + 품목</td></tr>${combos.map(k => row(k)).join('')}
    ${extra.length ? `<tr class="grp"><td colspan="5">검색광고 연관 키워드</td></tr>${extra.map(k => row(k)).join('')}` : ''}</tbody></table>`;
  const anyVol = names.concat(combos).some(k => vol(k));
  $('kwBasis').textContent = anyVol ? '네이버 검색광고 월간 검색량 기준' : '검색량 미확인 · 조회 버튼을 눌러주세요';
  $('kwBasis').className = 'pill ' + (anyVol ? 'ok' : '');
};

function kwStatus(msg, kind = '') { const el = $('kwStatus'); el.hidden = false; el.textContent = msg; el.className = 'status ' + kind; }
async function lookup() {
  const s = KK.state, { names, combos } = KK.keywordCandidates(s);
  if (!names.length) return KK.toast('아파트명을 먼저 입력해 주세요.', 'error');
  const btn = $('kwLookup'); btn.disabled = true; btn.textContent = '검색광고에서 조회 중…';
  kwStatus('크롬의 네이버 검색광고 키워드 도구에서 조회하고 있어요. 그 창을 건드리지 마세요…');
  try {
    const all = [...names, ...combos];
    const hint = all.map(k => k.replace(/\s+/g, ''));
    let out;
    if (KK.searchadReady) {   // 1순위: 공식 검색광고 API
      const r = await fetch('/api/keywords', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keywords: hint }) });
      out = await r.json();
    } else out = await KK.ext('KEYWORD_VOLUME', { keywords: hint }, 120000);   // 2순위: 확장 프로그램
    if (!out.ok) throw Error(out.error || '조회 실패');
    const now = Date.now(); related = [];
    for (const r of out.rows || []) {
      const pc = num(r.pc), mo = num(r.mobile);
      cache[norm(r.keyword)] = { pc: pc.n, mo: mo.n, pcRaw: pc, moRaw: mo, at: now };
      if (aptNames(s.apt).some(n => norm(r.keyword).includes(norm(n)))) related.push(r.keyword);
    }
    KK.store.set(CACHE_KEY, cache);
    applyRecommendation();
    kwStatus('✓ 검색량 ' + (out.rows || []).length + '개를 불러왔어요. 검색량이 가장 많은 조합으로 A·B를 골랐어요.', 'ok');
  } catch (e) { kwStatus('검색량 조회 실패: ' + e.message, 'error'); $('kwHelp').hidden = false; $('diagCopy').hidden = false; }
  finally { btn.disabled = false; btn.textContent = '검색량 조회 (네이버 검색광고)'; }
}
function applyRecommendation() {
  const r = recommend(KK.state);
  KK.state.kwA = r.A; KK.state.kwB = r.B;
  KK.changed('keywords');
}

/* CSV / TSV — 키워드도구 [다운로드] 파일 */
function parseDelimited(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean), sep = lines[0].includes('\t') ? '\t' : ',';
  return lines.map(line => { const out = []; let f = '', q = false; for (let i = 0; i < line.length; i++) { const c = line[i]; if (c === '"') { if (q && line[i + 1] === '"') { f += '"'; i++; } else q = !q; } else if (c === sep && !q) { out.push(f); f = ''; } else f += c; } out.push(f); return out.map(x => x.trim()); });
}
async function importCsv(file) {
  const buf = await file.arrayBuffer();
  let text = new TextDecoder('utf-8').decode(buf);
  if ((text.match(/�/g) || []).length > 3) text = new TextDecoder('euc-kr').decode(buf);
  const rows = parseDelimited(text);
  const hi = rows.findIndex(r => r.some(c => /연관키워드|키워드/.test(c)));
  if (hi < 0) throw Error('키워드 열을 찾지 못했어요.');
  const h = rows[hi].map(x => x.replace(/\s+/g, ''));
  const kI = h.findIndex(x => /키워드/.test(x)), pI = h.findIndex(x => /PC/i.test(x) && /검색/.test(x)), mI = h.findIndex(x => /모바일/.test(x) && /검색/.test(x));
  if (pI < 0 && mI < 0) throw Error('PC/모바일 월간검색수 열을 찾지 못했어요.');
  let n = 0;
  for (const r of rows.slice(hi + 1)) {
    if (!r[kI]) continue;
    const pc = num(r[pI]), mo = num(r[mI]);
    cache[norm(r[kI])] = { pc: pc.n, mo: mo.n, pcRaw: pc, moRaw: mo, at: Date.now() }; n++;
  }
  KK.store.set(CACHE_KEY, cache);
  return n;
}

async function refreshSettings() {
  try { const r = await (await fetch('/api/settings')).json(); KK.searchadReady = !!r.hasCreds;
    $('saState').textContent = r.hasCreds ? '✓ API 연결됨 (고객 ID ' + r.customerId + ')' : '미설정 — 아래 3가지를 입력해 주세요';
    $('saState').className = 'pill ' + (r.hasCreds ? 'ok' : 'bad'); } catch (_) {}
}
KK.initKeywords = () => {
  refreshSettings();
  $('saSave').addEventListener('click', async () => {
    const body = { customerId: $('saCustomer').value, apiKey: $('saKey').value, secretKey: $('saSecret').value };
    const r = await (await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
    if (!r.ok) return KK.toast(r.error, 'error');
    $('saKey').value = ''; $('saSecret').value = ''; await refreshSettings(); KK.toast('검색광고 API 키를 이 PC에 저장했어요.', 'ok');
  });
  $('kwLookup').addEventListener('click', lookup);
  $('kwRecommend').addEventListener('click', applyRecommendation);
  $('kwTable').addEventListener('click', e => {
    const b = e.target.closest('[data-set]'); if (!b) return;
    KK.state['kw' + b.dataset.set] = b.dataset.k; KK.changed('keywords');
  });
  $('kwCsv').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try { const n = await importCsv(f); applyRecommendation(); KK.toast('CSV에서 검색량 ' + n + '개를 불러왔어요.', 'ok'); }
    catch (err) { KK.toast('CSV를 읽지 못했어요: ' + err.message, 'error'); }
  });
};
})();
