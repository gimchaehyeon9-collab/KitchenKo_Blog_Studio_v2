/* 템플릿 자동완성 — AI 없이 입력값과 문장 뱅크로 블로그 원고를 만듭니다. */
(() => {
'use strict';
const KK = window.KK;
const { fill, josa, pick, rng, count } = KK;

const itemDefs = keys => KK.ITEMS.filter(i => keys.includes(i.key));
const firstItem = s => itemDefs(s.items)[0] || KK.ITEMS[0];

/* 기본 키워드: A = 아파트명, B = 아파트명 + 첫 품목 대표 키워드 (예: 주방 인테리어) */
KK.defaultKeywords = s => {
  const apt = (s.apt || '').trim();
  return { A: apt, B: apt ? apt + ' ' + firstItem(s).kw[0] : '' };
};
KK.keywords = s => {
  const d = KK.defaultKeywords(s);
  return { A: (s.kwA || '').trim() || d.A, B: (s.kwB || '').trim() || d.B };
};

/* 몇 번째 문단에 키워드로 시작하는 문장을 쓸지 (실제 글: 첫 문단·중간·마지막) */
function keywordSlots(n, kw, s) {
  const slots = new Array(n).fill('');
  if (!n || !kw.B) return slots;
  slots[0] = kw.B;
  if (n >= 2) slots[n - 1] = kw.B;
  // 중간에 한 번 더 — 문단 주제에 따라 A(아파트명)와 B(아파트명+품목) 중 어울리는 쪽을 넣습니다
  if (n >= 4) {
    const mid = Math.floor(n / 2);
    const card = (s.cards || [])[mid];
    const tp = card ? KK.topicOf(card) : null;
    // 전체 느낌·구조처럼 공간 전체를 말하는 문단이면 품목까지 넣은 B, 서랍·도어처럼 부분을 말하는 문단이면 아파트명 A
    const wide = !tp || ['overview', 'structure'].includes(tp.t);
    const pickKw = wide ? kw.B : (kw.A || kw.B);
    if (pickKw && pickKw !== slots[0]) slots[mid] = pickKw;
    else if (kw.A && kw.A !== kw.B) slots[mid] = kw.A;
  }
  return slots;
}

function featureObjs(card) {
  const sp = KK.SPACES[card.space] || KK.SPACES.overview;
  return (card.feats || []).map(name => sp.f[name]).filter(Boolean);
}

/* 앞 문단에서 쓴 키워드 문장과 많이 닮은 문장은 제외 (예: '벽면을 가득 채우는 …'이 두 번) */
function tooAlike(a, b) {
  const g = t => { const x = String(t).replace(/[^가-힣]/g, ''), out = new Set(); for (let i = 0; i < x.length - 2; i++) out.add(x.slice(i, i + 3)); return out; };
  const A = g(a), B2 = g(b); if (!A.size || !B2.size) return false;
  let hit = 0; A.forEach(v => B2.has(v) && hit++);
  return hit / Math.min(A.size, B2.size) > 0.25;
}

/* 앞에서 이미 쓴 '눈에 띄는 단어'가 적은 문장을 고릅니다 (같은 점수면 랜덤) */
function overlap(text, used) {
  let score = 0;
  for (const w of KK.SIGNATURE) if (text.includes(w)) score += Math.min(3, KK.count(used, w));
  return score;
}
function best(list, used, rand, seen) {
  let top = null, topScore = Infinity;
  const fresh = seen ? list.filter(c => !seen.has(c)) : list;
  for (const c of (fresh.length ? fresh : list)) { const sc = overlap(c, used) + rand() * 0.9; if (sc < topScore) { top = c; topScore = sc; } }
  if (seen) seen.add(top);
  return top;
}
const GENERIC_K = ['공간에 꼭 맞춘 맞춤가구로 {K}의 완성도를 높였습니다.', '작은 부분까지 사이즈를 맞춰 {K|을} 빈틈없이 제작했습니다.', '사용하시는 분의 생활 방식을 먼저 생각해 {K|을} 계획했습니다.'];
const GENERIC = ['공간에 맞춰 가구를 새롭게 계획했습니다.', '이 부분도 사이즈를 꼼꼼하게 맞춰 제작했습니다.', '쓰임새를 먼저 생각해 가구 구성을 정했습니다.'];
/* 사용자가 적은 '꼭 넣을 내용'을 문장으로 만들어 넣기 (문장이 아니면 '~을 함께 구성했습니다.'로, 지시문이면 건너뜀) */
function toSentence(t) {
  t = String(t || '').trim().replace(/\s+/g, ' '); if (!t) return '';
  if (/[.!?]$/.test(t)) return t;
  if (/(다|요)$/.test(t)) return t + '.';
  // '인덕션 부분 설명', '밥솥장 강조' 처럼 AI에게 하는 지시는 본문에 넣지 않음 (사진 보고 자동 작성에서 반영됩니다)
  if (/(설명|이야기|언급|강조|위주|넣어|써 ?줘|해 ?줘)/.test(t)) return '';
  return KK.fill('{M|을} 함께 구성했습니다.', { M: t.replace(/\s*(등|등등)$/, '') });
}
function insertSentence(text, hint, atEnd) {
  const sen = toSentence(hint); if (!sen || text.includes(sen)) return text;
  if (!text.includes('\n')) return atEnd ? (text + ' ' + sen).trim() : (sen + ' ' + text).trim();   // 한 덩어리(이어 쓰기)면 줄을 새로 만들지 않음
  const [first, ...rest] = text.split('\n');
  const body = rest.join(' ');
  return first + '\n' + (atEnd ? (body + ' ' + sen).trim() : (sen + ' ' + body).trim());
}
/* '~했' 줄기를 '~해' 연결형으로 (적용했→적용해, 넣었→넣어, 채웠→채워, 맞췄→맞춰 …) */
function conn(stem) {
  const last = stem.slice(-1), head = stem.slice(0, -1);
  const map = { '했': '해', '웠': '워', '렸': '려', '췄': '춰', '줬': '줘', '짰': '짜', '였': '여', '왔': '와', '쳤': '쳐', '졌': '져', '켰': '켜', '뒀': '둬', '갔': '가', '섰': '서' };
  if (map[last]) return head + map[last];
  if (last === '었') return head + '어';
  if (last === '았') return head + '아';
  return stem + '고';
}
const usesTone = t => /\{(base|mood)/.test(t);

function paragraph(card, K, ctx) {
  const { tone, rand } = ctx;
  const sp = KK.SPACES[card.space] || KK.SPACES.overview;
  const vars = { K, base: ctx.base, mood: ctx.mood };
  const feats = card.feats || [];
  const norm = x => typeof x === 'string' ? { t: x } : x;
  const okLead = l => !l.req || feats.includes(l.req);              // 사진에 없는 가구를 말하지 않도록
  const all = (K ? sp.leadK : sp.lead).map(norm).filter(okLead);
  let leads = all.filter(l => !ctx.usedLeads.has(l.t) && !(ctx.toneUsed && usesTone(l.t)));   // 컬러 설명은 글 전체에서 한 번만
  if (!leads.length) leads = (K ? GENERIC_K : GENERIC).filter(t => !ctx.usedLeads.has(t)).map(t => ({ t }));
  if (!leads.length) leads = all.filter(l => !(ctx.toneUsed && usesTone(l.t)));
  const toneLeads = leads.filter(l => usesTone(l.t));
  const reqLeads = leads.filter(l => l.req);
  const pool = !ctx.toneUsed && ctx.index === 0 && toneLeads.length ? toneLeads : reqLeads.length && ctx.rand() < .6 ? reqLeads : leads;
  const chosenT = best(pool.map(l => l.t), ctx.used, rand);
  const chosen = pool.find(l => l.t === chosenT);
  ctx.usedLeads.add(chosen.t); if (usesTone(chosen.t)) ctx.toneUsed = true;
  const lead = KK.fill(chosen.t, vars);

  const f = featureObjs({ ...card, feats: feats.filter(n => n !== chosen.req) });   // 첫 문장에서 말한 특징은 반복하지 않음
  let used = ctx.used + lead;
  const st = [];
  for (const x of f) { const v = best(x.s, used, rand, ctx.seen); st.push(v); used += ' ' + v; }   // 같은 문단 안에서도 겹침 확인
  const fxOf = i => best(f[i].fx, used, rand, ctx.seen);
  let rest;
  // 기존 글처럼 '~해 + 효과'로 한 문장 안에서 이어 씁니다 (예: 인출식 수납장을 적용해 깊숙한 공간까지 편리하게 활용할 수 있는데요.)
  const fxs = st.map((_, i) => best(f[i].fx, used, rand, ctx.seen));
  const linked = i => conn(st[i]) + ' ' + fxs[i];
  if (f.length >= 3) rest = st[0] + '으며, ' + st[1] + '습니다. ' + linked(2);
  else if (f.length === 2) rest = rand() < .6 ? linked(0) + ' ' + linked(1) : st[0] + (rand() < .5 ? '으며, ' : '고, ') + st[1] + '습니다. ' + fxs[rand() < .5 ? 1 : 0];
  else if (f.length === 1) rest = rand() < .7 ? linked(0) : st[0] + (!fxs[0].includes('는데요') ? '는데요. ' : '습니다. ') + fxs[0];
  else rest = best(KK.FALLBACK, used, rand, ctx.seen);
  // 기존 글처럼 충분한 길이가 되도록 효과·마무리 문장을 덧붙임 (겹치지 않는 것만)
  // 특징마다 효과 문장은 하나만 (같은 뜻을 두 번 쓰지 않게)
  const fxPerFeat = f.filter(x => !x.fx.some(v => rest.includes(v))).map(x => best(x.fx, ctx.used + lead + rest, rand));
  const extras = [...fxPerFeat, ...((KK.CLOSE || {})[card.space] || []), ...(rest.length < 80 ? (KK.CLOSE_ANY || []) : [])];
  let guard = 0, genericUsed = 0;
  while (rest.length < (KK.MIN_DETAIL || 150) && guard++ < 2) {
    const shared = x => KK.SIGNATURE.filter(w => x.includes(w) && (lead + rest).includes(w)).length;
    const isGeneric = x => (KK.CLOSE_ANY || []).includes(x);
    const pool = extras.filter(x => !rest.includes(x) && !ctx.seen.has(x) && shared(x) < 2 && !(genericUsed && isGeneric(x)));   // 겹치는 문장·공통 문장 2개 이상 제외
    if (!pool.length) break;
    const add = best(pool, ctx.used + lead + rest, rand, ctx.seen);
    rest += ' ' + add; if (isGeneric(add)) genericUsed++;
  }
  return lead + ctx.sep + varyEndings(rest, rand);
}


/* ── 문장 창고(사장님 실제 문장)로 문단 만들기 ── */
const ROOM = { '안방': /안방/, '작은방': /작은 ?방|아이 ?방/, '복도': /복도/ };
/* 사장님 문체에서 벗어나는 문장 걸러내기: 해요체(~예요), '~해줍니다', 막연한 군더더기, 사장님이 쓰지 말라고 하신 말 */
const OFF_STYLE = /(?<!는데)(?<!인데)요\.$|줍니다|실사용|실제 사용|세심|완성도(를| 높)|다양한 (물품|주방 ?용품|크기|용도|물건|소품)|보이지 않는|편리함을 더|불편함 없|사용 편의성|질리지 않|입면|면 구성|수평|수직 라인|직선 위주|패널처럼|하나의 (면|벽)처럼|작업 동선|손그림자/;
KK.styleOk = s => !OFF_STYLE.test(String(s || ''));
let BANK = null;
function bank() {
  if (BANK) return BANK;
  BANK = (KK.BANK || []).filter(r => KK.styleOk(r[2])).map(([g, t, s, f, c, first, need]) => {
    const ff = f.slice(); for (const [k, re] of Object.entries(ROOM)) if (re.test(s)) ff.push(k);
    if (!c.includes('밝은') && /밝고|밝은 (톤|컬러|색)|화사한 톤|환한 톤/.test(s)) c = [...c, '밝은'];
    if (!c.includes('짙은') && /짙은|어두운 톤|딥한/.test(s)) c = [...c, '짙은'];
    if (!ff.includes('간접조명') && /밝아져|조명|불빛|빛이/.test(s)) ff.push('간접조명');
    if (!ff.includes('손잡이') && !ff.includes('플랫 도어') && /라인 (포인트|디테일)/.test(s)) ff.push('플랫 도어');
    if (ff.includes('우드 포인트') === false && /우드(톤)? ?(선반|포인트|오픈장|마감)/.test(s)) ff.push('우드 포인트');
    return { g, t, s, f: ff, c, first: !!first, need: need || [] };
  });
  return BANK;
}
KK.autoTopics = s => {
  const g = KK.ITEM_GROUP[(s.items || [])[0]] || 'kitchen', o = KK.AUTO_ORDER[g], n = s.cards.length;
  s.cards.forEach((c, i) => {
    if (c.topicManual || c.topicAi) return;   // 사용자가 직접 고르거나 Claude가 사진 보고 정한 카드는 순서 규칙으로 덮어쓰지 않음
    const t = i === 0 ? o.first : (i === n - 1 && n > 2) ? o.last : o.mid[(i - 1) % o.mid.length];
    const tp = KK.TOPICS.find(x => x.g === g && x.t === t) || KK.TOPICS.find(x => x.g === g);
    c.topic = tp.key; c.space = tp.space;
  });
};
KK.topicOf = card => KK.TOPICS.find(x => x.key === card.topic) || KK.TOPICS[0];
function bankOk(x, card, tp, ctx, allowK) {
  if (ctx.seen.has(x.s)) return false;
  if (x.g !== tp.g && !(x.g === 'etc' && ['overview', 'door', 'storage'].includes(x.t))) return false;
  if (x.need.length && !x.need.includes(tp.g)) return false;          // 다른 공간 이야기(신발·식기·의류 등) 금지
  const allowed = new Set([...(card.feats || []).filter(f => !KK.SOFT_CHIPS.has(f)), ...tp.imply]);
  if (x.f.some(f => !allowed.has(f))) return false;                 // 사진에 없는 것은 쓰지 않음
  const colors = new Set(KK.TONE_COLORS[ctx.toneKey] || []);
  if (x.c.some(c => !colors.has(c))) return false;                  // 다른 색 이야기 금지
  if (x.c.length && ctx.toneUsed && ctx.index > 0) return false;    // 컬러 설명은 앞쪽에서 한 번
  const hasK = x.s.includes('{K');
  if (hasK !== !!allowK) return false;
  return true;
}
function bankScore(x, card, used, rand, cover, wantColor) {
  let sc = rand() * 1.2 - overlap(x.s, used) * 0.8 + (wantColor && x.c.length ? 4 : 0);
  for (const f of x.f) if ((card.feats || []).includes(f) && !cover.has(f)) sc += 3;   // 고른 특징을 다룬 문장 우선
  for (const f of (card.feats || [])) { const d = KK.SOFT_CHIPS.has(f) && KK.chipDef(f); if (d && d.re.test(x.s) && !cover.has(f)) sc += 2.5; }   // 분위기·강조 키워드
  if (x.s.length < 40) sc -= 1;
  return sc;
}
function pickBank(list, card, used, rand, cover, wantColor) {
  let top = null, ts = -1e9;
  for (const x of list) { const v = bankScore(x, card, used, rand, cover, wantColor); if (v > ts) { ts = v; top = x; } }
  return top;
}

/* 문장 끝이 '~습니다.'로만 이어지지 않게: 사장님 글처럼 '~했는데요.' / '~했으며,' 로 섞기 */
const JONG = ch => { const c = ch.charCodeAt(0) - 0xAC00; return c >= 0 && c < 11172 ? c % 28 : -1; };
const dropJong = ch => String.fromCharCode(ch.charCodeAt(0) - JONG(ch));
function softEnd(sen) {           // 문장을 '~는데요.' 로
  let m = /^(.*)(.)습니다\.$/.exec(sen);
  if (m && JONG(m[2]) === 20) return m[1] + m[2] + '는데요.';                     // 했습니다 → 했는데요
  m = /^(.*)(.)니다\.$/.exec(sen);
  if (m && JONG(m[2]) === 17) {                                                     // ㅂ니다
    const base = dropJong(m[2]);
    if (base === '이' && /[가-힣]$/.test(m[1]) && !/(보|높|줄|돋보|드러나|이어지)$/.test(m[1])) return m[1] + '인데요.';   // 공간입니다 → 공간인데요
    return m[1] + base + '는데요.';                                                 // 합니다 → 하는데요, 줍니다 → 주는데요
  }
  return null;
}
function joinEnd(sen) {           // 문장을 '~했으며,' / '~하며,' 로 (다음 문장과 이어 붙임)
  let m = /^(.*)(.)습니다\.$/.exec(sen);
  if (m && JONG(m[2]) === 20) return m[1] + m[2] + '으며,';
  m = /^(.*)(.)니다\.$/.exec(sen);
  if (m && JONG(m[2]) === 17) { const base = dropJong(m[2]); if (base === '이' && !/(보|높|줄|돋보)$/.test(m[1])) return null; return m[1] + base + '며,'; }
  return null;
}
function varyEndings(detail, rand) {
  const ss = detail.split(/(?<=[다요]\.)\s+/).filter(Boolean);
  if (ss.length < 2) return detail;
  let soft = /는데요\.|인데요\./.test(detail) ? 1 : 0, joined = 0;
  for (let i = 0; i < ss.length - 1; i++) {
    if (!/니다\.$/.test(ss[i]) || !/니다\.$/.test(ss[i + 1])) continue;              // '~니다'가 두 번 연달아 나올 때만
    if (!soft && rand() < .55) { const v = softEnd(ss[i]); if (v) { ss[i] = v; soft++; continue; } }
    if (!joined && ss[i].length + ss[i + 1].length < 150 && !/며,|고,|며 |하고 /.test(ss[i] + ss[i + 1])) { const v = joinEnd(ss[i]);   /* 이미 '~며,'가 있는 문장은 잇지 않음 */ if (v) { ss[i] = v + ' ' + ss[i + 1]; ss.splice(i + 1, 1); joined++; continue; } }
    if (!soft) { const v = softEnd(ss[i]); if (v) { ss[i] = v; soft++; } }
  }
  return ss.join(' ');
}

function bankParagraph(card, K, ctx) {
  const tp = KK.topicOf(card), B = bank(), rand = ctx.rand, vars = { K };
  const sameT = B.filter(x => x.t === tp.t);
  const groupWide = B.filter(x => x.t !== tp.t);
  const cover = new Set();
  const take = x => { ctx.seen.add(x.s); ctx.seen.add(KK.fill(x.s, vars)); x.f.forEach(f => cover.add(f)); for (const f of (card.feats || [])) { const d = KK.SOFT_CHIPS.has(f) && KK.chipDef(f); if (d && d.re.test(x.s)) cover.add(f); } if (x.c.length) ctx.toneUsed = true; return KK.fill(x.s, vars); };
  // 첫 문장
  let leadPool = sameT.filter(x => x.first && bankOk(x, card, tp, ctx, false));
  if (!leadPool.length) leadPool = sameT.filter(x => bankOk(x, card, tp, ctx, false));
  if (leadPool.length < 1 || sameT.filter(x => bankOk(x, card, tp, ctx, false)).length < 2) return null;   // 창고 부족 → 기본 문장
  let used = ctx.used;
  const lead = take(pickBank(leadPool, card, used, rand, cover, ctx.index === 0 && !ctx.toneUsed)); used += lead;   // 첫 문단은 컬러·분위기 문장 우선
  // 이어지는 문장 (같은 주제 → 부족하면 같은 품목 다른 주제)
  const parts = [];
  const maxN = K ? 2 : 3;
  for (let n = 0; n < 4; n++) {
    const len = parts.join(' ').length;
    if (len >= (KK.MIN_DETAIL || 140) || n >= maxN) break;
    const shared = x => KK.SIGNATURE.filter(w => x.s.includes(w) && (lead + parts.join(' ')).includes(w)).length;
    let pool = sameT.filter(x => !x.first && bankOk(x, card, tp, ctx, false) && shared(x) < 2);
    if (!pool.length) pool = sameT.filter(x => bankOk(x, card, tp, ctx, false) && shared(x) < 2);
    if (!pool.length) pool = groupWide.filter(x => !x.first && x.g === tp.g && bankOk(x, card, tp, ctx, false) && shared(x) < 2);
    if (!pool.length) break;
    const s = take(pickBank(pool, card, used, rand, cover)); parts.push(s); used += s;
  }
  // 고른 키워드가 하나도 빠지지 않게: 창고 문장에 없던 키워드는 키워드 문구로 문장을 만들어 넣음
  for (const f of (card.feats || [])) {
    if (cover.has(f) || tp.imply.includes(f)) continue;
    const d = KK.chipDef(f); if (!d || (d.g && !d.g.includes(tp.g))) continue;
    const sen = KK.SOFT_CHIPS.has(f) ? d.s + '.' : d.c + ' ' + d.e + '.';
    if (!ctx.seen.has(sen)) { parts.push(sen); ctx.seen.add(sen); cover.add(f); }
  }
  // 키워드 문장: 창고의 '…{K}입니다' 같은 문장을 끝에 붙이고, 없으면 기본 키워드 문장을 앞에
  let first = lead;
  if (K) {
    const kp = B.filter(x => x.t === tp.t && bankOk(x, card, tp, ctx, true)).concat(B.filter(x => x.t !== tp.t && x.g === tp.g && bankOk(x, card, tp, ctx, true)));
    const kp2 = kp.filter(x => !(ctx.kList || []).some(p => tooAlike(x.s, p)));
    const noteK = t => { (ctx.kList = ctx.kList || []).push(t); ctx.kUsed = (ctx.kUsed || '') + ' ' + KK.fill(t, vars); };
    if (kp2.length) {
      // 첫 문단은 사장님 글처럼 '단지명 + 공간은 …분위기를 완성했습니다.'로 시작: {K}로 시작하는 문장이 있으면 맨 앞으로
      const lead0 = ctx.index === 0 ? kp2.filter(x => /^\{K[|}]/.test(x.s) && /분위기|톤|컬러|질감/.test(x.s)) : [];
      const x = pickBank(lead0.length ? lead0 : kp2, card, used + ' ' + (ctx.kUsed || ''), rand, cover); const v = take(x); noteK(x.s);
      if (lead0.length) { parts.unshift(first); first = v; } else parts.push(v);
    }
    else {
      const sp = KK.SPACES[tp.space] || KK.SPACES.overview;
      const ts = (sp.leadK || []).filter(l => typeof l === 'string' || (card.feats || []).includes(l.req)).map(l => typeof l === 'string' ? l : l.t)
        .filter(l => KK.styleOk(l))
        .filter(l => !/\{(base|mood)/.test(l) || !ctx.toneUsed)
        .map(l => [l, KK.fill(l, { K, base: ctx.base, mood: ctx.mood })])
        .filter(([l2, f]) => !ctx.seen.has(f) && !ctx.seen.has(l2) && !(ctx.kList || []).some(p => tooAlike(l2, p)));
      if (ts.length) { const [l, f] = ts[Math.floor(rand() * ts.length)]; ctx.seen.add(f); ctx.seen.add(l); noteK(l); if (/\{(base|mood)/.test(l)) ctx.toneUsed = true; first = f + ' ' + lead; }
      else if (kp.length) { const x = pickBank(kp, card, used + ' ' + (ctx.kUsed || ''), rand, cover); const v = take(x); noteK(x.s); parts.push(v); }
      else { const v = KK.fill('{K|은} 공간에 맞춘 제작가구로 완성했습니다.', { K }); noteK(v); parts.push(v); }
    }
  }
  return first + ctx.sep + varyEndings(parts.join(' '), rand);
}

const shuffle = (list, rand) => { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

function titleOptions(s, kw, tone) {
  const it = firstItem(s), space = it.space;
  const rand = rng((s.seed || 1) * 977 + 3);
  // 사진 카드에서 고른 특징 중 제목에 쓸 만한 것
  const ts = [];
  for (const c of s.cards) {
    for (const n of (c.feats || [])) { const t = KK.TITLE_FEAT[n]; if (t && !ts.includes(t)) ts.push(t); }
    for (const f of featureObjs(c)) if (f.t && !ts.includes(f.t)) ts.push(f.t);
  }
  const apt = (kw.A || s.apt || '').trim();
  const B = (kw.B || apt || '키친앤코 맞춤가구').trim();
  const region = (s.region || '').trim().split(/\s+/).slice(0, 2).join(' ');
  const emo = KK.TITLE_SPACE[space] || KK.TITLE_SPACE[it.space] || KK.TITLE_VALUES;
  const V = {
    B, A: apt, it: it.label, sp: space, ts: tone.short, tt: tone.title,
    f1: ts[0] || '', f2: ts[1] || '', region,
    value: '', emotion: '', mood: ''
  };
  // 같은 설명이 두 제목에 겹치지 않게, 쓸 때마다 아직 안 쓴 것을 꺼냅니다
  const pools = { value: shuffle(KK.TITLE_VALUES, rand), emotion: shuffle(emo, rand), mood: shuffle(KK.TITLE_MOODS, rand) };
  const nextOf = k => { const p = pools[k]; return p.length > 1 ? p.shift() : p[0]; };
  const has = n => n === 'f1' ? !!V.f1 : n === 'f2' ? !!(V.f1 && V.f2) : n === 'region' ? !!region : true;
  // 계열(k)마다 하나씩 — 같은 구조가 두 번 나오지 않게
  const byKind = new Map();
  for (const form of KK.TITLE_FORMS) {
    if (form.need && !has(form.need)) continue;
    if (!byKind.has(form.k)) byKind.set(form.k, []);
    byKind.get(form.k).push(form);
  }
  const out = [], seen = new Set(), usedForms = new Set();
  const add = t => {
    for (const k of ['value', 'emotion', 'mood']) if (t.includes('{' + k + '}')) V[k] = nextOf(k);
    // '주방가구 하나로 달라진 … 주방'처럼 품목과 공간이 겹쳐 어색한 제목은 건너뜁니다
    if (/\{it[|}][\s\S]*\{sp[|}]|\{sp[|}][\s\S]*\{it[|}]/.test(t) && (V.it.includes(V.sp) || V.sp.includes(V.it))) return false;
    if (usedForms.has(t)) return false; usedForms.add(t);
    const v = fill(t, V).replace(/\s{2,}/g, ' ').replace(/\s+,/g, ',').trim();
    if (!v || /\{|^,|,\s*$/.test(v) || v.length > 48) return false;
    const key = v.replace(/\s/g, ''); if (seen.has(key)) return false;
    if (v.endsWith(B) && out.filter(x => x.endsWith(B)).length >= 3) return false;   // 끝맺음이 다 똑같지 않게
    seen.add(key); out.push(v); return true;
  };
  // 1순위: 계열마다 하나씩 (kw 계열을 맨 앞에 두어 검색용 제목이 첫 번째가 되게)
  const kinds = ['kw', 'tone', 'feat', 'life', 'story'];
  for (const k of kinds) { const list = byKind.get(k); if (list && list.length) add(pick(rand, list).t); }
  // 2순위: 남은 형태로 7개까지 채움 (같은 계열이어도 문장 구조가 다른 것만)
  const rest = KK.TITLE_FORMS.filter(f => (!f.need || has(f.need)));
  for (let i = 0; i < rest.length && out.length < 7; i++) add(rest[(i * 3 + (s.seed || 1)) % rest.length].t);
  for (let i = 0; i < rest.length && out.length < 7; i++) add(rest[i].t);
  return out.slice(0, 7);
}

KK.hashtags = s => {
  const apt = (s.apt || '').replace(/\s+/g, '');
  if (!apt) return [];
  const tags = [apt, apt + '인테리어'];
  if (KK.brandKey === 'lemon') return KK.lemonTags ? KK.lemonTags(s) : tags;   // 레몬하우스 모드는 가구 품목 태그를 붙이지 않아요
  for (const it of itemDefs(s.items)) for (const t of it.tags) tags.push(apt + t);
  tags.push(apt + '제작가구');
  return [...new Set(tags)].slice(0, 30);
};

/* 원고 전체 생성. 사용자가 직접 고친 문단(edited)은 그대로 둡니다. */
KK.compose = (s, { regenerate = false } = {}) => {
  if (KK.brandKey === 'lemon' && KK.lemonCompose) return KK.lemonCompose(s);   // 레몬하우스: 블로그별 문체·서식 (lemon-profile.js)
  const tone = KK.TONES[s.tone] || KK.TONES.darkwood;
  const kw = KK.keywords(s);
  const rand = rng(s.seed || 1);
  const slots = keywordSlots(s.cards.length, kw, s);
  const ctx = { tone, toneKey: s.tone, rand, seen: new Set(), usedLeads: new Set(), toneUsed: false, used: '', sep: s.lineBreak === false || (KK.lineJoin && KK.lineJoin()) ? ' ' : '\n',   // 줄바꿈 없이 이어 쓰기가 켜져 있으면 첫 문장 뒤에도 줄을 바꾸지 않음
    base: pick(rand, tone.base), mood: pick(rand, tone.mood) };
  const mainRand = ctx.rand;
  s.cards.forEach((card, i) => {
    ctx.index = i;
    ctx.rand = card.salt ? rng((s.seed || 1) * 7919 + card.salt * 104729 + i) : mainRand;   // [다시 쓰기]한 문단만 다른 표현
    if (!card.edited || regenerate) {
      card.text = bankParagraph(card, slots[i], ctx) || paragraph({ ...card, space: KK.topicOf(card).space }, slots[i], ctx); card.edited = false;
      if (card.hint) card.text = insertSentence(card.text, card.hint);
      if (i === s.cards.length - 1 && (s.must || '').trim()) card.text = insertSentence(card.text, s.must, true);
    }
    ctx.used += '\n' + card.text;
  });
  const items = itemDefs(s.items);
  const greeting = fill(KK.BRAND.greeting, { apt: s.apt || '○○', intro: (s.intro || '').trim() || tone.intro, itemText: fixPair(items) });
  const specLines = ['■ 시공 현장 : ' + [s.region, s.apt].filter(Boolean).join(' '), '■ 시공 품목 : ' + (items.map(i => i.label).join(', ') || '맞춤가구')];
  if ((s.specs || '').trim()) specLines.push('■ 가구 사양 : ' + s.specs.trim());
  const titles = titleOptions(s, kw, tone);
  const title = (s.title || '').trim() || titles[(s.titlePick ?? 0) % titles.length];
  return { title, titles, specLines, greeting, footer: KK.BRAND.footer, homepage: KK.BRAND.homepage, tags: KK.hashtags(s), kw };
  function fixPair(list) {
    if (!list.length) return '맞춤가구';
    if (list.length === 1) return list[0].label;
    return list.slice(0, -1).map(i => i.label).join(', ').replace(/(.+)$/, m => josa(m, '와')) + ' ' + list.at(-1).label;
  }
};

/* 키워드 사용 횟수 (제목·해시태그 제외, 인사말+본문 기준) */
KK.audit = (s, doc) => {
  const body = [doc.greeting, ...s.cards.map(c => c.text)].join('\n');
  return ['A', 'B'].map(k => ({ key: k, word: doc.kw[k], count: count(body, doc.kw[k]) })).filter(x => x.word);
};

/* 네이버에 붙여넣기·복사용 전체 텍스트 */
KK.plainText = (s, doc) => doc.lemon && KK.lemonPlainText ? KK.lemonPlainText(s, doc) : [
  doc.title, '', '[대표사진]', '', ...doc.specLines, '', '[장소: ' + (s.apt || '') + ']', '', doc.greeting, '',
  ...s.cards.flatMap((c, i) => ['[사진 ' + (i + 1) + ']', c.text, '']),
  '• • • • •', '', doc.footer, doc.homepage, '', '[동영상]', '', doc.tags.map(t => '#' + t).join('')
].join('\n');
})();
