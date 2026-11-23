/* 공통 도구 — 모든 스크립트가 window.KK 하나만 공유합니다. */
(() => {
'use strict';
const KK = window.KK = window.KK || {};

KK.$ = id => document.getElementById(id);
KK.esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
KK.norm = s => String(s || '').replace(/\s+/g, '').toLowerCase();
KK.uid = (() => { let n = 1; return p => (p || 'id') + (n++); })();

/* 한국어 조사: 받침 유무로 을/를, 이/가, 은/는, 와/과, 으로/로 선택 */
function lastHangul(word) {
  const chars = [...String(word || '').trim()];
  for (let i = chars.length - 1; i >= 0; i--) {
    const code = chars[i].charCodeAt(0);
    if (code >= 0xAC00 && code <= 0xD7A3) return code;
    if (/[0-9]/.test(chars[i])) return { '0': 0xC601, '1': 0xC77C, '2': 0xC774, '3': 0xC0BC, '4': 0xC0AC, '5': 0xC624, '6': 0xC721, '7': 0xCE60, '8': 0xD314, '9': 0xAD6C }[chars[i]]; // 영,일,이,삼,사,오,육,칠,팔,구
    if (/[a-z]/i.test(chars[i])) return /[lmnr]$/i.test(chars[i]) ? 0xAC01 /*받침 있는 것으로*/ : 0xAC00;
  }
  return 0xAC00;
}
const PAIRS = { '을': ['을', '를'], '를': ['을', '를'], '이': ['이', '가'], '가': ['이', '가'], '은': ['은', '는'], '는': ['은', '는'], '과': ['과', '와'], '와': ['과', '와'], '으로': ['으로', '로'], '로': ['으로', '로'], '이라': ['이라', '라'], '라': ['이라', '라'], '이에요': ['이에요', '예요'], '예요': ['이에요', '예요'] };
KK.josa = (word, p) => {
  const pair = PAIRS[p]; if (!pair) return word + p;
  const code = lastHangul(word), jong = (code - 0xAC00) % 28;
  if (pair[0] === '으로') return word + (jong === 0 || jong === 8 ? '로' : '으로'); // ㄹ 받침은 '로'
  return word + (jong ? pair[0] : pair[1]);
};
/* "{color|으로} 맞췄습니다" 같은 템플릿 채우기 */
KK.fill = (tpl, vars) => tpl.replace(/\{(\w+)(?:\|([가-힣]+))?\}/g, (_, k, p) => {
  const v = vars[k]; if (v == null || v === '') return '';
  return p ? KK.josa(String(v), p) : String(v);
}).replace(/\s{2,}/g, ' ').trim();

/* 재현 가능한 랜덤 — '문장 다시 섞기' 할 때 seed만 바꿉니다 */
KK.rng = seed => { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; };
KK.pick = (rand, list) => list[Math.floor(rand() * list.length) % list.length];

KK.count = (hay, needle) => { if (!needle) return 0; return String(hay).split(needle).length - 1; };

KK.store = {
  get(key, fallback) { try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (_) { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (_) { return false; } }
};

KK.toast = (msg, kind = '') => {
  const box = KK.$('toast'); if (!box) return;
  box.textContent = msg; box.className = 'toast show ' + kind;
  clearTimeout(KK.toast.t); KK.toast.t = setTimeout(() => box.className = 'toast', kind === 'error' ? 6000 : 3200);
};

KK.copy = async text => {
  if (!text) throw Error('복사할 내용이 없습니다.');
  try { await navigator.clipboard.writeText(text); }
  catch (e) {
    const t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.append(t); t.select(); const ok = document.execCommand('copy'); t.remove(); if (!ok) throw e;
  }
};

KK.download = (name, data, mime) => {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'application/octet-stream' });
  const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(u), 2000);
};
KK.dataUrlBytes = url => { const b = atob(url.split(',')[1] || ''); const out = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i); return out; };

/* 외부 라이브러리 없이 만드는 ZIP (무압축) */
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = b => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
KK.zip = entries => {
  const enc = new TextEncoder(), parts = [], central = []; let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name), data = typeof e.data === 'string' ? enc.encode(e.data) : e.data, crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
    parts.push(new Uint8Array(h.buffer), name, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const size = central.reduce((s, x) => s + x.length, 0), end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, size, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
};
})();
