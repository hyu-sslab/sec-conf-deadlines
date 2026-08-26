// 파생 데이터 (DR-004). 전부 빌드 타임 계산이며 디스크에 쓰지 않는다.
// 순수 함수는 records를 인자로 받아 Astro 밖에서도 테스트된다.
import type { CollectionEntry } from 'astro:content';
import {
  KST,
  calendarDateIn,
  dDay,
  daysSince,
  deadlineInstant,
  formatCalendarDate,
  formatInZone,
  isPast,
  monthKeyOf,
  type CalendarDate,
} from './dates.ts';

export type ConferenceRecord = CollectionEntry<'conferences'>['data'];
export type EditionRecord = ConferenceRecord['editions'][number];
export type Confidence = EditionRecord['confidence'];

/** 등급 거리 계산용 척도 (FR-022). 낮을수록 상위. */
const ICORE_SCORE: Record<string, number> = { 'A*': 0, A: 1, B: 2, C: 3 };
/** ICORE 미확인 시 교내 등급으로 대신한다. A≈A*, B≈A, C≈B, D≈C */
const INTERNAL_SCORE: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };

/**
 * watchlist 창 (DR-005). 빌드가 며칠 밀려도 대상을 놓치지 않도록 넉넉히 잡고,
 * 정확한 오프셋(D-7/-3/-1/0/+1) 선별은 실행 당일 watch.py가 한다.
 */
export const WATCH_WINDOW = { from: -2, to: 14 } as const;

export interface ResolvedDate {
  /** CFP 원문 표기 그대로. 원 타임존 기준이며 대조가 필요할 때 쓴다. */
  raw: string;
  /** 절대 시각 */
  instant: Date;
  /** KST 환산 — 화면에 쓰는 유일한 표기 */
  kst: string;
  /** KST 달력 날짜 — 라벨·그룹핑·D-day의 단일 기준 (decisions.md B-6). */
  date: CalendarDate;
}

export interface Deadline {
  /** 추천 캐시의 키. 학회·연도·사이클로 유일하다. */
  key: string;
  conference: ConferenceRecord;
  year: number;
  cycle: number;
  timezone: string;

  abstract: ResolvedDate | null;
  /** 목록의 1차 정렬·그룹핑 기준 (FR-016) */
  fullPaper: ResolvedDate | null;
  rebuttal: [string, string] | null;
  notification: string | null;
  cameraReady: string | null;

  conferenceDate: string | null;
  place: string | null;
  note: string;
  sourceUrl: string;
  lastVerifiedAt: string;
  confidence: Confidence;

  /** BR-004 — estimated에는 카운트다운을 적용하지 않으므로 null이다. */
  dday: number | null;
  isPast: boolean;
  isEstimated: boolean;
  /** 월 그룹핑 키 `2026-09`. 마감이 없으면 null. */
  monthKey: string | null;
  /** FR-022의 등급 근접도. 등급 미상이면 null. */
  rankScore: number | null;
  /** 마지막 확인으로부터 지난 일수. 30일 이상이면 UI가 경고한다. */
  staleDays: number;
}

function resolve(raw: string | null, timezone: string): ResolvedDate | null {
  if (raw === null) return null;
  const instant = deadlineInstant(raw, timezone);
  return {
    raw,
    instant,
    kst: formatInZone(instant, KST),
    date: calendarDateIn(instant, KST),
  };
}

/** ICORE가 1축, 없으면 교내 등급으로 대신한다. */
export function rankScoreOf(conference: ConferenceRecord): number | null {
  const { icore, internal } = conference.ranks;
  if (icore.rank !== null) return ICORE_SCORE[icore.rank];
  if (internal.grade !== null) return INTERNAL_SCORE[internal.grade];
  return null;
}

export function editionKey(conferenceId: string, year: number, cycle: number): string {
  return `${conferenceId}#${year}#${cycle}`;
}

/** 학회 × 에디션을 목록 단위 항목으로 편다. */
export function toDeadline(
  conference: ConferenceRecord,
  edition: EditionRecord,
  now: Date,
): Deadline {
  const { timezone } = edition;
  const fullPaper = resolve(edition.dates.full_paper, timezone);
  const isEstimated = edition.confidence === 'estimated';

  return {
    key: editionKey(conference.id, edition.year, edition.cycle),
    conference,
    year: edition.year,
    cycle: edition.cycle,
    timezone,

    abstract: resolve(edition.dates.abstract, timezone),
    fullPaper,
    rebuttal: edition.dates.rebuttal,
    notification: edition.dates.notification,
    cameraReady: edition.dates.camera_ready,

    conferenceDate: edition.conference_date,
    place: edition.place,
    note: edition.note,
    sourceUrl: edition.source_url,
    lastVerifiedAt: edition.last_verified_at,
    confidence: edition.confidence,

    // BR-004. D-day도 KST로 센다 — 라벨과 같은 기준이어야 하루가 어긋나지 않는다.
    dday: isEstimated || !fullPaper ? null : dDay(fullPaper.instant, now, KST),
    isPast: fullPaper ? isPast(fullPaper.instant, now) : false,
    isEstimated,
    monthKey: fullPaper ? monthKeyOf(fullPaper.date) : null,
    rankScore: rankScoreOf(conference),
    staleDays: daysSince(edition.last_verified_at, now, KST),
  };
}

export function buildDeadlines(records: ConferenceRecord[], now: Date): Deadline[] {
  return records
    .flatMap((conference) =>
      conference.editions.map((edition) => toDeadline(conference, edition, now)),
    )
    .sort(compareByDeadline);
}

/** 마감 오름차순. 마감 없는 항목은 뒤로 민다. */
export function compareByDeadline(a: Deadline, b: Deadline): number {
  if (!a.fullPaper && !b.fullPaper) return a.key.localeCompare(b.key);
  if (!a.fullPaper) return 1;
  if (!b.fullPaper) return -1;
  const diff = a.fullPaper.instant.getTime() - b.fullPaper.instant.getTime();
  return diff !== 0 ? diff : a.key.localeCompare(b.key);
}

/* ------------------------------------------------------------------ *
 * 월 그룹핑 (FR-016)
 * ------------------------------------------------------------------ */
export interface MonthGroup {
  /** `2026-09` */
  key: string;
  year: number;
  month: number;
  items: Deadline[];
}

export function groupByMonth(deadlines: Deadline[]): MonthGroup[] {
  const groups = new Map<string, MonthGroup>();

  for (const item of deadlines) {
    if (!item.monthKey || !item.fullPaper) continue;
    let group = groups.get(item.monthKey);
    if (!group) {
      group = {
        key: item.monthKey,
        year: item.fullPaper.date.year,
        month: item.fullPaper.date.month,
        items: [],
      };
      groups.set(item.monthKey, group);
    }
    group.items.push(item);
  }

  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * 탐색 범위 필터 (FR-017).
 * 월 네비게이터가 빈 달의 자리를 지켜야 하므로(요구사항 6.4) 월 목록은
 * 항목이 없어도 채워서 돌려준다.
 */
export function monthsInHorizon(now: Date, horizonMonths: number): string[] {
  const today = calendarDateIn(now, KST);
  const keys: string[] = [];
  for (let offset = 0; offset < horizonMonths; offset += 1) {
    const cursor = new Date(Date.UTC(today.year, today.month - 1 + offset, 1));
    keys.push(
      `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`,
    );
  }
  return keys;
}

/** 탐색 범위 필터 (FR-017). 일수가 아니라 월 단위로 자른다. */
export function withinHorizon(
  deadlines: Deadline[],
  now: Date,
  horizonMonths: number,
): Deadline[] {
  const allowed = new Set(monthsInHorizon(now, horizonMonths));
  return deadlines.filter((item) => item.monthKey !== null && allowed.has(item.monthKey));
}

/* ------------------------------------------------------------------ *
 * 카테고리 그룹핑
 *
 * 데이터 파일이 카테고리 단위이므로 학회는 정확히 한 카테고리에 속한다.
 * topics는 이와 별개인 다중 태그다 — 카테고리는 "어디에 사는가",
 * topics는 "무엇에 대한 학회인가"를 뜻한다.
 * ------------------------------------------------------------------ */
export interface CategoryGroup {
  key: string;
  label: string;
  order: number;
  conferences: ConferenceRecord[];
}

/* ------------------------------------------------------------------ *
 * 추천 (FR-020 · FR-021 · FR-022)
 * ------------------------------------------------------------------ */

/** FR-020 — 같은 학회의 다음 마감. */
export function nextEditionOf(
  target: Deadline,
  all: Deadline[],
  now: Date,
): Deadline | null {
  const upcoming = all
    .filter(
      (item) =>
        item.conference.id === target.conference.id &&
        item.key !== target.key &&
        item.fullPaper !== null &&
        !isPast(item.fullPaper.instant, now),
    )
    .sort(compareByDeadline);
  return upcoming[0] ?? null;
}

/** 윤년 보정을 포함한 연 단위 이동. 2028-02-29 → 2029-02-28 */
function addYears(value: string, years: number): string {
  const [datePart, timePart] = value.split(' ');
  const [year, month, day] = datePart.split('-').map(Number);
  const probe = new Date(Date.UTC(year + years, month - 1, day));
  const shifted: CalendarDate =
    probe.getUTCMonth() === month - 1
      ? { year: year + years, month, day }
      : { year: year + years, month, day: 28 };
  return timePart
    ? `${formatCalendarDate(shifted)} ${timePart}`
    : formatCalendarDate(shifted);
}

function shiftDates(dates: EditionRecord['dates'], years: number): EditionRecord['dates'] {
  const shift = (value: string | null) => value && addYears(value, years);
  return {
    abstract: shift(dates.abstract),
    full_paper: shift(dates.full_paper)!,
    rebuttal: dates.rebuttal
      ? [addYears(dates.rebuttal[0], years), addYears(dates.rebuttal[1], years)]
      : null,
    notification: shift(dates.notification),
    camera_ready: shift(dates.camera_ready),
  };
}

/** 날짜가 실제로 적힌 에디션만. 미수집 항목을 기준으로 삼으면 추정이 죽는다. */
function datedEditions(conference: ConferenceRecord): EditionRecord[] {
  return conference.editions
    .filter((edition) => edition.dates.full_paper !== null)
    .sort((a, b) => (a.year - b.year) || (a.cycle - b.cycle));
}

/**
 * FR-021 — 지난 패턴 기반 추정. confidence: estimated이므로 D-day가 없다.
 *
 * 두 가지를 구분한다.
 *
 *   같은 해에 남은 차수 — 1차가 끝났고 그 학회가 2차를 여는 곳이면 다음은 그해 2차다.
 *   해를 넘길 때      — 학회는 매년 1차부터 돈다. 차수를 물려받으면 안 된다.
 *
 * 날짜는 반드시 같은 차수끼리 옮긴다. 2차 일정에 1년을 더해 1차라고 부르면
 * 몇 달씩 어긋난다.
 */
export function estimateNextEdition(
  conference: ConferenceRecord,
  now: Date,
): Deadline | null {
  const dated = datedEditions(conference);
  const latest = dated.at(-1);
  if (!latest) return null;

  const candidates: { base: EditionRecord; year: number; cycle: number }[] = [];

  // 이 학회가 연 적 있는 차수 중 지금 차수 바로 다음 것 — 같은 해에 아직 남았다.
  const nextCycle = dated.filter((edition) => edition.cycle === latest.cycle + 1).at(-1);
  if (nextCycle) {
    candidates.push({ base: nextCycle, year: latest.year, cycle: nextCycle.cycle });
  }

  // 해를 넘기면 1차부터 다시 돈다.
  const firstCycle = dated.filter((edition) => edition.cycle === 1).at(-1);
  if (firstCycle) {
    candidates.push({ base: firstCycle, year: latest.year + 1, cycle: 1 });
  }
  if (candidates.length === 0) return null;

  const build = ({ base, year, cycle }: (typeof candidates)[number]) =>
    toDeadline(
      conference,
      {
        ...base,
        year,
        cycle,
        dates: shiftDates(base.dates, year - base.year),
        conference_date: null,
        place: null,
        note: `${base.year}년 ${base.cycle}차 일정에서 추정한 값이다. 공식 CFP로 확인해야 한다.`,
        confidence: 'estimated',
      },
      now,
    );

  // 같은 해 다음 차수가 이미 지났으면 해를 넘긴 쪽을 쓴다.
  const drafts = candidates.map(build);
  return drafts.find((item) => !item.isPast) ?? drafts[drafts.length - 1];
}

export interface AlternativeOptions {
  limit?: number;
}

export interface Alternatives {
  items: Deadline[];
  /** 같은 분야에서 찾았는가. false면 분야 조건을 푼 결과다. */
  sameField: boolean;
}

/** ICORE 순위를 정렬용 숫자로. 미상은 맨 뒤. */
function icoreOrder(item: Deadline): number {
  const rank = item.conference.ranks.icore.rank;
  return rank === null ? Number.POSITIVE_INFINITY : ICORE_SCORE[rank];
}

/**
 * FR-022 — 대안 추천. 분야가 먼저, 그 안에서 ICORE 순이다 (decisions.md B-9).
 * 겹치는 분야 수 ↓ → ICORE ↑ → 마감 ↑. 후보 0건이면 분야 조건만 푼다.
 */
export function similarAlternatives(
  target: Deadline,
  all: Deadline[],
  now: Date,
  options: AlternativeOptions = {},
): Alternatives {
  const { limit = 3 } = options;
  const targetTopics = new Set(target.conference.topics);

  const pool = all.filter((item) => {
    if (item.conference.id === target.conference.id) return false;
    if (item.isEstimated) return false;
    return item.fullPaper !== null && !isPast(item.fullPaper.instant, now);
  });

  const overlapOf = (item: Deadline) =>
    item.conference.topics.filter((topic) => targetTopics.has(topic)).length;

  const rank = (a: Deadline, b: Deadline, byOverlap: boolean): number => {
    if (byOverlap) {
      const diff = overlapOf(b) - overlapOf(a);
      if (diff !== 0) return diff;
    }
    const byIcore = icoreOrder(a) - icoreOrder(b);
    if (byIcore !== 0) return byIcore;
    return compareByDeadline(a, b);
  };

  const sameField = pool.filter((item) => overlapOf(item) > 0);
  if (sameField.length > 0) {
    return {
      items: sameField.sort((a, b) => rank(a, b, true)).slice(0, limit),
      sameField: true,
    };
  }

  // 같은 분야에 열려 있는 마감이 하나도 없을 때만 분야를 푼다.
  // 화면이 "같은 분야"라고 말하지 않도록 이 사실을 함께 돌려준다.
  return {
    items: [...pool].sort((a, b) => rank(a, b, false)).slice(0, limit),
    sameField: false,
  };
}

/** 지난 마감 항목에 붙는 대안 묶음 (DR-004). */
export interface Recommendation {
  nextEdition: Deadline | null;
  estimatedNextEdition: Deadline | null;
  alternatives: Alternatives;
}

export function recommendFor(
  target: Deadline,
  all: Deadline[],
  now: Date,
): Recommendation {
  const nextEdition = nextEditionOf(target, all, now);
  return {
    nextEdition,
    // 실제 차기 에디션이 있으면 추정값을 만들지 않는다 (FR-021).
    estimatedNextEdition: nextEdition ? null : estimateNextEdition(target.conference, now),
    alternatives: similarAlternatives(target, all, now),
  };
}

/* ------------------------------------------------------------------ *
 * 감시 대상 (DR-005 · FR-041)
 * ------------------------------------------------------------------ */
export interface WatchItem {
  id: string;
  key: string;
  name: string;
  year: number;
  cycle: number;
  /** 저장된 현재 마감. watch.py가 원문과 비교하는 기준값이다. */
  deadline: string;
  timezone: string;
  deadline_utc: string;
  source_url: string;
  dday: number;
}

export function buildWatchlist(deadlines: Deadline[], now: Date): WatchItem[] {
  return deadlines
    .filter((item) => {
      if (!item.fullPaper || item.isEstimated) return false;
      const offset = dDay(item.fullPaper.instant, now, KST);
      return offset >= WATCH_WINDOW.from && offset <= WATCH_WINDOW.to;
    })
    .map((item) => ({
      id: item.conference.id,
      key: item.key,
      name: item.conference.name,
      year: item.year,
      cycle: item.cycle,
      deadline: item.fullPaper!.raw,
      timezone: item.timezone,
      deadline_utc: item.fullPaper!.instant.toISOString(),
      source_url: item.sourceUrl,
      dday: dDay(item.fullPaper!.instant, now, KST),
    }))
    .sort((a, b) => a.dday - b.dday);
}

/* ------------------------------------------------------------------ *
 * Astro 진입점
 * ------------------------------------------------------------------ */
export async function loadConferences(): Promise<ConferenceRecord[]> {
  // 동적 임포트라서 이 모듈 자체는 Astro 밖에서도 불러올 수 있다.
  // 위의 순수 함수들은 별도 테스트 러너 없이 그대로 실행된다.
  const { getCollection } = await import('astro:content');
  const entries = await getCollection('conferences');
  return entries.map((entry) => entry.data);
}

export async function loadDeadlines(now: Date = new Date()): Promise<Deadline[]> {
  return buildDeadlines(await loadConferences(), now);
}

/**
 * 다음 에디션이 아직 등록되지 않은 학회를 전년도 패턴으로 추정한다 (FR-021).
 *
 * 이게 없으면 CFP가 늦게 나오는 분야(AI 계열이 대표적이다)는 화면에서
 * 통째로 사라진다. BR-004에 따라 추정값에는 카운트다운을 붙이지 않는다.
 */
export function projectedEditions(
  records: ConferenceRecord[],
  live: Deadline[],
  now: Date,
): Deadline[] {
  const liveIds = new Set(live.map((item) => item.conference.id));
  return records
    .filter((conference) => !liveIds.has(conference.id) && conference.editions.length > 0)
    .map((conference) => estimateNextEdition(conference, now))
    .filter(
      (item): item is Deadline => item !== null && item.fullPaper !== null && !item.isPast,
    );
}

export interface PageDeadlines {
  /** 원본 레코드. 추정 에디션을 만들 때 필요하다. */
  records: ConferenceRecord[];
  all: Deadline[];
  /** 본문 마감이 있는 것만 */
  dated: Deadline[];
  live: Deadline[];
  /** 최근 것부터 */
  past: Deadline[];
}

/** 페이지들이 똑같이 반복하던 준비 과정. */
export async function loadPageDeadlines(now: Date): Promise<PageDeadlines> {
  const records = await loadConferences();
  const all = buildDeadlines(records, now);
  const dated = all.filter((item) => item.fullPaper !== null);
  return {
    records,
    all,
    dated,
    live: dated.filter((item) => !item.isPast),
    past: dated.filter((item) => item.isPast).reverse(),
  };
}

