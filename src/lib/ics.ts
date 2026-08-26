/**
 * iCalendar 생성 (RFC 5545). 전체 피드와 마감별 파일이 같은 코드를 쓴다.
 */
import type { Deadline } from './deadlines.ts';
import { MS, toIcsUtc } from './dates.ts';
import { editionTitle } from './title.ts';
import { SITE_ID } from './config.ts';

/** 75 옥텟마다 접는다. */
function fold(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;

  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < bytes.length) {
    let size = Math.min(chunks.length === 0 ? 75 : 74, bytes.length - cursor);
    // UTF-8 연속 바이트(0b10xxxxxx) 한가운데를 자르면 캘린더 앱에서 깨진다.
    while (size > 1 && (bytes[cursor + size] & 0xc0) === 0x80) size -= 1;
    chunks.push(bytes.subarray(cursor, cursor + size).toString('utf8'));
    cursor += size;
  }
  return chunks.join('\r\n ');
}

function escapeText(value: string): string {
  return value.replace(/([\;,])/g, '\\$1').replace(/\n/g, '\\n');
}

/** 종일 이벤트의 DTEND는 배타적이라 다음 날을 적는다. */
function nextDay(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10).replace(/-/g, '');
}

/** `usenix-sec#2027#1` → `usenix-sec-2027-1`. `#`는 URL에서 조각 구분자다. */
export function icsSlug(key: string): string {
  return key.replace(/#/g, '-');
}

/** ICS 요약용. 캘린더 앱에 따라 한글 처리가 고르지 않아 사이클을 `c2`로 적는다. */
export function titleOf(item: Deadline): string {
  return editionTitle(item, (cycle) => ` c${cycle}`);
}

function descriptionOf(item: Deadline): string {
  return [
    `마감: ${item.fullPaper!.kst} KST`,
    item.notification ? `통보: ${item.notification}` : null,
    `확인: ${item.lastVerifiedAt} (${item.confidence})`,
    `CFP: ${item.sourceUrl}`,
  ]
    .filter((value): value is string => value !== null)
    .join('\n');
}

/**
 * 마감 이벤트. `withNotification`이면 통보일(종일)도 함께 낸다.
 *
 * 전체 피드는 둘 다 싣는다 — 통보는 졸업 일정 역산의 입력값이다.
 * 카드의 "캘린더에 추가"는 마감 하나만 넣는다.
 */
export function eventsFor(
  item: Deadline,
  stamp: string,
  withNotification = true,
): string[] {
  const title = titleOf(item);
  const description = descriptionOf(item);
  const start = toIcsUtc(item.fullPaper!.instant);

  const lines = [
    'BEGIN:VEVENT',
    fold(`UID:${item.key}@${SITE_ID}`),
    `DTSTAMP:${stamp}`,
    `DTSTART:${start}`,
    `DTEND:${start}`,
    fold(`SUMMARY:${escapeText(`${title} 마감`)}`),
    fold(`DESCRIPTION:${escapeText(description)}`),
    fold(`URL:${item.sourceUrl}`),
    'END:VEVENT',
  ];

  if (withNotification && item.notification) {
    lines.push(
      'BEGIN:VEVENT',
      fold(`UID:${item.key}-notification@${SITE_ID}`),
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${item.notification.replace(/-/g, '')}`,
      `DTEND;VALUE=DATE:${nextDay(item.notification)}`,
      fold(`SUMMARY:${escapeText(`${title} 통보`)}`),
      fold(`DESCRIPTION:${escapeText(description)}`),
      fold(`URL:${item.sourceUrl}`),
      'END:VEVENT',
    );
  }
  return lines;
}

export function calendar(events: string[], name: string): string {
  return `${[
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${SITE_ID}//KO`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    fold(`X-WR-CALNAME:${escapeText(name)}`),
    ...events,
    'END:VCALENDAR',
  ].join('\r\n')}\r\n`;
}

/**
 * Google 캘린더 일정 등록 URL.
 *
 * 구독이 아니라 **일정 하나를 미리 채워 넣는** 링크다. 길이가 0인 일정은
 * 표시가 어색해 30분 블록으로 만든다.
 */
export function googleEventUrl(item: Deadline): string {
  const start = item.fullPaper!.instant;
  const end = new Date(start.getTime() + 30 * MS.minute);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${titleOf(item)} 마감`,
    dates: `${toIcsUtc(start)}/${toIcsUtc(end)}`,
    details: descriptionOf(item),
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}
