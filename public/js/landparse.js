/* 네이버 부동산 면적 글 읽기 — 붙여넣은 글·열린 탭 글자에서 113.67Am² 같은 공급면적(타입 글자 포함)을 찾아요.
   블로그 화면 [부동산 찾기]와 레몬 현장 탭 [현장 고르기]가 같이 써요. (읽기만 해요) */
(() => {
'use strict';
const PYEONG = 3.3058;
const areaKey = a => (a.letter || '') + '|' + a.py.toFixed(1);

// 붙여넣은 글에서 면적 찾기 — 113.67Am² · 공급면적 113.67m² · 113.67A/84.97m² · (평으로 바꿔 보이면) 34A평
function parseAreas(raw) {
  const t = String(raw || '').replace(/㎡/g, 'm²').replace(/\bm2\b/gi, 'm²').replace(/\s+/g, ' ');
  const num = '(?<![\\d.])(\\d{2,3}(?:\\.\\d+)?)';
  const list = [], excls = [];
  const add = (supply, letter, excl) => {
    const v = parseFloat(supply); if (!(v >= 20 && v <= 400)) return;
    list.push({ supply: v, letter: String(letter || '').toUpperCase(), excl: excl ? parseFloat(excl) : 0 });
  };
  for (const m of t.matchAll(new RegExp(num + '\\s*([A-Za-z]{0,2})\\s*(?:m²)?\\s*/\\s*' + num + '\\s*m²', 'g'))) { add(m[1], m[2], m[3]); excls.push(parseFloat(m[3])); }
  for (const m of t.matchAll(new RegExp('(전용|공급|계약)?\\s*(?:면적)?\\s*:?\\s*' + num + '\\s*([A-Za-z]{1,2})?\\s*m²', 'g'))) {
    if (m[1] === '전용') { excls.push(parseFloat(m[2])); continue; }
    add(m[2], m[3]);
  }
  // 같은 면적은 하나로 (타입 글자·전용면적은 있는 쪽을 살림)
  const by = new Map();
  for (const a of list) {
    if (!a.letter && !a.excl && excls.some(x => Math.abs(x - a.supply) < 0.011)) continue;   // 전용면적으로 보이는 값
    const k = a.supply.toFixed(2), c = by.get(k);
    if (!c) by.set(k, { ...a }); else { c.letter = c.letter || a.letter; c.excl = c.excl || a.excl; }
  }
  let items = [...by.values()];
  if (items.some(a => a.letter)) items = items.filter(a => a.letter);   // 타입 글자가 붙은 것이 공급면적 칩
  items.forEach(a => { a.py = a.supply / PYEONG; });
  if (!items.length) {   // 평으로 보이는 페이지: 34A평 · 34.4평
    const seen = new Set();
    for (const m of t.matchAll(new RegExp(num + '\\s*([A-Za-z]{0,2})\\s*평', 'g'))) {
      const py = parseFloat(m[1]); if (!(py >= 8 && py <= 120)) continue;
      const a = { supply: 0, excl: 0, letter: m[2].toUpperCase(), py }, k = areaKey(a);
      if (!seen.has(k)) { seen.add(k); items.push(a); }
    }
  }
  return items.sort((a, b) => a.py - b.py);
}
// 직접 적은 평수: 34 · 34평 · 34A · 34a평
function parseManualPy(raw) {
  const m = /^\s*(\d{1,3}(?:\.\d+)?)\s*([A-Za-z]{0,2})\s*평?\s*$/.exec(String(raw || ''));
  if (!m) return null;
  const py = parseFloat(m[1]); if (!(py >= 8 && py <= 120)) return null;
  return { supply: 0, excl: 0, letter: m[2].toUpperCase(), py };
}

window.KK = window.KK || {};
window.KK.landParse = { parseAreas, parseManualPy, areaKey, PYEONG };
})();
