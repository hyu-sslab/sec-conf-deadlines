// 날짜 계산. 오프셋은 Intl에서 얻는다 — 고정 테이블을 두면 AoE·KST 밖의
// 타임존과 서머타임을 손으로 다뤄야 한다.

/** Anywhere on Earth. CFP가 타임존을 안 밝히면 이걸로 본다. */
export const AOE = 'Etc/GMT+12';

/** 화면에 쓰는 유일한 표시 기준 (decisions.md B-6). */
export const KST = 'Asia/Seoul';

/** 밀리초 단위. 시간 계산은 전부 이 값으로 한다 — 리터럴을 다시 쓰지 않는다. */
export const MS = {
  second: 1_000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
} as const;

export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

/** `YYYY-MM-DD` 또는 `YYYY-MM-DD HH:mm`. 스키마가 형식을 보장한다. */
export type DateString = string;

interface WallClock extends CalendarDate {
  hour: number;
  minute: number;
  second: number;
}

const PARTS_CACHE = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = PARTS_CACHE.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    PARTS_CACHE.set(timeZone, formatter);
  }
  return formatter;
}

/** 그 타임존의 벽시계가 가리키는 값. */
export function wallClockIn(instant: Date, timeZone: string): WallClock {
  const parts = partsFormatter(timeZone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

/** 그 시각에 적용되는 타임존 오프셋(ms). */
function offsetAt(instant: Date, timeZone: string): number {
  const wall = wallClockIn(instant, timeZone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return asUtc - instant.getTime();
}

/**
 * 벽시계 시각 → 절대 시각.
 *
 * 오프셋은 "그 시각이 언제인가"에 달려 있는데 그 시각을 아직 모르므로,
 * 한 번 추정해 오프셋을 얻고 그 값으로 다시 푼다. 서머타임 경계에서
 * 첫 추정이 한 시간 어긋나는 것을 두 번째 통과가 바로잡는다.
 */
export function zonedTimeToInstant(wall: WallClock, timeZone: string): Date {
  const target = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );
  const first = target - offsetAt(new Date(target), timeZone);
  return new Date(target - offsetAt(new Date(first), timeZone));
}

/**
 * 마감 문자열을 절대 시각으로.
 *
 * 시각이 없으면 그날 23:59로 본다 — 마감은 하루의 끝이지 시작이 아니다.
 */
export function deadlineInstant(value: DateString, timeZone: string): Date {
  const { year, month, day } = parseCalendarDate(value);
  const timePart = value.split(' ')[1];
  const [hour, minute] = timePart ? timePart.split(':').map(Number) : [23, 59];
  return zonedTimeToInstant({ year, month, day, hour, minute, second: 0 }, timeZone);
}

/** `YYYY-MM-DD…` 의 날짜 부분. 타임존을 거치지 않으므로 시각은 보지 않는다. */
export function parseCalendarDate(value: DateString): CalendarDate {
  const [year, month, day] = value.split(' ')[0].split('-').map(Number);
  return { year, month, day };
}

export function calendarDateIn(instant: Date, timeZone: string): CalendarDate {
  const { year, month, day } = wallClockIn(instant, timeZone);
  return { year, month, day };
}

const pad = (value: number) => String(value).padStart(2, '0');

/** `2026-08-26` */
export function formatCalendarDate(date: CalendarDate): string {
  return `${date.year}-${pad(date.month)}-${pad(date.day)}`;
}

/** `2026-08` — 월 그룹핑의 키. */
export function monthKeyOf(date: CalendarDate): string {
  return `${date.year}-${pad(date.month)}`;
}

/** 달력상 날짜 차이(일). 시각은 보지 않으므로 D-day가 하루 어긋나지 않는다. */
export function daysBetween(from: CalendarDate, to: CalendarDate): number {
  const a = Date.UTC(from.year, from.month - 1, from.day);
  const b = Date.UTC(to.year, to.month - 1, to.day);
  return Math.round((b - a) / MS.day);
}

/** 남은 날수. 라벨과 같은 타임존으로 세야 하루가 어긋나지 않는다. */
export function dDay(instant: Date, now: Date, timeZone: string): number {
  return daysBetween(calendarDateIn(now, timeZone), calendarDateIn(instant, timeZone));
}

/** 그 날짜 이후 며칠 지났나. 확인일이 얼마나 묵었는지 재는 데 쓴다. */
export function daysSince(value: DateString, now: Date, timeZone: string): number {
  return daysBetween(parseCalendarDate(value), calendarDateIn(now, timeZone));
}

/** 마감 통과 여부는 달력이 아니라 절대 시각으로 본다. */
export function isPast(instant: Date, now: Date): boolean {
  return instant.getTime() < now.getTime();
}

/** `2026-08-26 20:59` — 화면 표기. */
export function formatInZone(instant: Date, timeZone: string): string {
  const wall = wallClockIn(instant, timeZone);
  return `${formatCalendarDate(wall)} ${pad(wall.hour)}:${pad(wall.minute)}`;
}

/** `20260826T115900Z` — RFC 5545의 UTC 표기. */
export function toIcsUtc(instant: Date): string {
  return `${instant.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
}

export interface Remaining {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

/** 남은 시간을 일·시간·분·초로 쪼갠다. 서버 렌더와 카운트다운이 함께 쓴다. */
export function splitRemaining(ms: number): Remaining {
  const left = Math.max(0, ms);
  return {
    days: Math.floor(left / MS.day),
    hours: Math.floor((left % MS.day) / MS.hour),
    minutes: Math.floor((left % MS.hour) / MS.minute),
    seconds: Math.floor((left % MS.minute) / MS.second),
  };
}
