/**
 * 화면과 클라이언트 스크립트가 함께 쓰는 상수.
 *
 * 이 파일은 `astro:content`를 비롯한 서버 전용 모듈에 의존하지 않는다.
 * 브라우저 번들에 그대로 들어가야 하기 때문이다 — 값을 하나만 두려면
 * 양쪽에서 같은 모듈을 import할 수 있어야 한다.
 */

/** 목록의 기본 탐색 범위(개월). 필터를 초기화해도 이 값으로 돌아간다. */
export const DEFAULT_HORIZON_MONTHS = 12;

/**
 * D-day 3단계의 경계(일). 색과 강조가 여기서 갈린다.
 * 값을 바꾸면 서버 렌더와 카운트다운이 함께 따라온다.
 */
export const URGENCY_DAYS = { imminent: 7, prepare: 45 } as const;

/** D-day 3단계: 1 임박 · 2 준비 · 3 여유. */
export function urgencyTier(dday: number): 1 | 2 | 3 {
  if (dday <= URGENCY_DAYS.imminent) return 1;
  if (dday <= URGENCY_DAYS.prepare) return 2;
  return 3;
}

/** 마감을 모르는 항목은 급할 이유가 없다. 정렬·색에서 "여유"로 다룬다. */
export const RELAXED_TIER = 3;

/** 토스트가 떠 있는 시간(ms). */
export const TOAST_MS = 2400;

/**
 * 이 배포본의 식별자. ICS의 UID·PRODID와 수집 스크립트의 User-Agent가 쓴다.
 * 포크하면 여기만 바꾸면 된다.
 */
export const SITE_ID = 'sec-conf-deadlines';
