// 해시태그 만들기 — 카페 글 맨 아래 "태그를 입력해주세요(최대 10개)" 칸에 넣는다.
//
// 규칙 (사용자 지정, 6~8개) — 예: 해운대구 재송동 센텀파크1차
//   해운대리모델링, 센텀파크1차리모델링, 센텀파크1차인테리어, 센텀파크리모델링, 재송동리모델링, 센텀파크인테리어
//   (+ 해운대인테리어, 재송동인테리어)
//   · 구는 "구/시/군"을 뗀 이름(해운대구 → 해운대), 동은 그대로
//   · 아파트명은 "1차" 같은 차수가 있으면 차수 있는 이름·없는 이름 둘 다 쓴다
//   · 차수가 없는 단지는 같은 태그가 겹치므로, 모자라는 만큼 구·동 인테리어 태그로 채워 6개 이상을 맞춘다
// '#' 은 붙이지 않고 단어만 저장한다 (카페 태그 칸에 단어만 넣는다). 화면에서는 #을 붙여 보여 준다.

const 붙여쓰기 = (s) => String(s || '').replace(/[\s#]/g, '');

/** 구 입력이 "수원시 영통구" 처럼 길면 마지막 단어만 쓰고, 끝의 구/시/군은 뗀다. (해운대구 → 해운대, 두 글자 이하는 그대로) */
const 구이름 = (s) => {
  const parts = String(s || '').trim().split(/\s+/).filter(Boolean);
  const last = 붙여쓰기(parts[parts.length - 1] || '');
  const stem = last.replace(/[구시군]$/, '');
  return stem.length >= 2 ? stem : last;
};

/** 아파트명에서 끝의 "아파트"를 떼고, 차수("1차")를 나눈다. 센텀파크1차 → { 전체: 센텀파크1차, 기본: 센텀파크, 차수있음: true } */
function 단지이름(s) {
  const 전체 = 붙여쓰기(s).replace(/아파트$/, '');
  const 기본 = 전체.replace(/\d+차$/, '');
  return { 전체, 기본: 기본 || 전체, 차수있음: 기본 !== 전체 && !!기본 };
}

const MAX_LEN = 20; // 카페 태그는 하나당 20자까지

/**
 * 기본 태그 6~8개. (카페 태그 칸은 최대 10개)
 * 이미 직접 고친 태그 목록(job.tags)이 있으면 그것을 존중하므로, 이 함수는 '처음 만들 때'와 '다시 만들기'에만 쓴다.
 * keywordCount > 0 이면 본문 키워드 제안을 그만큼 뒤에 더한다 (기본 0 — 지정한 형식만).
 */
function build(job, { keywordCount = 0 } = {}) {
  const apt = 단지이름(job.아파트명);
  const gu = 구이름(job.구);
  const dong = 붙여쓰기(job.동);
  const keywords = ((job.draft && job.draft.keywords) || []).map(붙여쓰기).filter(Boolean);

  const 후보 = [];
  if (gu) 후보.push(`${gu}리모델링`);
  if (apt.전체) 후보.push(`${apt.전체}리모델링`);
  if (apt.전체) 후보.push(`${apt.전체}인테리어`);
  if (apt.차수있음) 후보.push(`${apt.기본}리모델링`);
  if (dong) 후보.push(`${dong}리모델링`);
  if (apt.차수있음) 후보.push(`${apt.기본}인테리어`);
  if (gu) 후보.push(`${gu}인테리어`);
  if (dong) 후보.push(`${dong}인테리어`);

  const list = [...new Set(후보)].filter((t) => t.length <= MAX_LEN).slice(0, 8);
  list.push(...keywords.slice(0, keywordCount).filter((k) => k.length <= MAX_LEN));
  return [...new Set(list)].slice(0, 10);
}

/** 화면에 보여 줄 추천 키워드 중 아직 태그에 없는 것. */
function suggestions(job) {
  const have = new Set(job.tags || []);
  return ((job.draft && job.draft.keywords) || []).map(붙여쓰기).filter((k) => k && !have.has(k));
}

module.exports = { build, suggestions, 구이름, 단지이름 };
