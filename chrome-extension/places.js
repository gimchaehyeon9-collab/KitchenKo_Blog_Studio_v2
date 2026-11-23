/* 아파트 이름·주소 비교 도우미 (네이버 부동산 단지 찾기용)
   화면(public/js/places.js)과 크롬 확장(chrome-extension/places.js)이 같은 파일을 씁니다. 한쪽만 고치지 마세요. */
(function (root) {
  'use strict';
  const addressKey = value => String(value || '')
    .replace(/(서울|부산|대구|인천|광주|대전|울산|세종)(?:특별자치|특별|광역)?시/g, '$1')
    .replace(/경기도/g, '경기').replace(/충청북도/g, '충북').replace(/충청남도/g, '충남')
    .replace(/전라북도|전북특별자치도/g, '전북').replace(/전라남도/g, '전남')
    .replace(/경상북도/g, '경북').replace(/경상남도/g, '경남')
    .replace(/강원특별자치도|강원도/g, '강원').replace(/제주특별자치도|제주도/g, '제주')
    .replace(/[\s,.·()]/g, '').toLowerCase();
  const placeName = value => addressKey(String(value || '').replace(/^(?:\S+(?:동|읍|면|리)\s+)+/, '').replace(/아파트|\bapt\b/gi, ''));
  function nameDistance(a, b, substring = false) {
    let row = Array.from({ length: b.length + 1 }, (_, i) => substring ? 0 : i);
    for (let i = 1; i <= a.length; i++) {
      const next = [i];
      for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + Number(a[i - 1] !== b[j - 1]));
      row = next;
    }
    return substring ? Math.min(...row) : row[b.length];
  }
  function relatedPlace(a, b) {
    a = placeName(a); b = placeName(b);
    if (Math.min(a.length, b.length) < 2) return a === b && !!a;
    const numbers = s => (s.match(/\d+/g) || []).join(',');
    if (numbers(a) && numbers(b) && numbers(a) !== numbers(b)) return false;
    if (a.includes(b) || b.includes(a)) return true;
    const [short, long] = a.length <= b.length ? [a, b] : [b, a];
    return short.length >= 4 && nameDistance(short, long, true) <= Math.max(1, Math.floor(short.length * .2));
  }
  function nameQueries(name) {
    const clean = String(name || '').replace(/\s*(?:아파트|apt)$/i, '').replace(/\s+/g, ' ').trim(), core = placeName(clean);
    return [...new Set([clean, core, ...(core.length > 2 ? [core.slice(0, -1), core.slice(0, Math.max(2, core.length - 2)), core.slice(0, Math.max(2, Math.floor(core.length / 2)))] : [])].filter(Boolean))];
  }
  function regionMatches(region, address) {
    const tokens = String(region || '').trim().split(/\s+/).filter(t => /(?:시|도|구|군|동|읍|면|리)$/.test(t));
    return tokens.every(t => addressKey(address).includes(addressKey(t)));
  }
  function complexQueries(name, region = '') {
    const area = String(region || '').trim().split(/\s+/).filter(t => /(?:시|도|구|군|동|읍|면|리)$/.test(t)).map(addressKey).join(' ');
    return [...new Set(nameQueries(name).flatMap(n => [area && `${area} ${n}`.length <= 30 ? `${area} ${n}` : '', n.slice(0, 30)]).filter(Boolean))];
  }
  const api = { addressKey, placeName, nameDistance, relatedPlace, nameQueries, regionMatches, complexQueries };
  root.KKPlaces = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
