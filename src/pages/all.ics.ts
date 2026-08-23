/**
 * FR-030 — 전체 마감 ICS 피드.
 *
 * 태그별 피드(FR-031)와 Atom 피드(FR-034)는 v1 스코프 밖이다.
 */
import type { APIRoute } from 'astro';
import { loadDeadlines } from '../lib/deadlines.ts';
import { calendar, eventsFor } from '../lib/ics.ts';
import { toIcsUtc } from '../lib/dates.ts';

export const GET: APIRoute = async () => {
  const now = new Date();
  const stamp = toIcsUtc(now);
  const events = (await loadDeadlines(now))
    // BR-004 — 추정값은 캘린더에 넣지 않는다.
    .filter((item) => item.fullPaper !== null && !item.isEstimated)
    .flatMap((item) => eventsFor(item, stamp));

  return new Response(calendar(events, 'Security Conference Deadlines'), {
    headers: { 'content-type': 'text/calendar; charset=utf-8' },
  });
};
