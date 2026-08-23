/**
 * 마감 하나짜리 ICS. "캘린더에 추가"가 이 파일을 연다.
 *
 * 애플에는 일정을 넣는 URL이 없다. iOS·macOS가 .ics를 열면 캘린더가 "추가"
 * 화면을 띄우는 것이 유일한 경로다.
 *
 * **마감 하나만 담는다.** 통보일까지 넣으면 카드에서 버튼 한 번 눌렀는데
 * 일정이 둘 생긴다. 통보일은 전체 피드(all.ics)의 몫이다.
 */
import type { APIRoute, GetStaticPaths } from 'astro';
import { loadDeadlines } from '../../lib/deadlines.ts';
import { calendar, eventsFor, icsSlug, titleOf } from '../../lib/ics.ts';
import { toIcsUtc } from '../../lib/dates.ts';

export const getStaticPaths: GetStaticPaths = async () => {
  const now = new Date();
  // 추정값은 캘린더에 넣지 않는다 (BR-004). 지난 마감도 만들지 않는다.
  return (await loadDeadlines(now))
    .filter((item) => item.fullPaper !== null && !item.isEstimated && !item.isPast)
    .map((item) => ({ params: { slug: icsSlug(item.key) }, props: { key: item.key } }));
};

export const GET: APIRoute = async ({ props }) => {
  const now = new Date();
  const item = (await loadDeadlines(now)).find((row) => row.key === props.key)!;

  return new Response(calendar(eventsFor(item, toIcsUtc(now), false), titleOf(item)), {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': `attachment; filename="${icsSlug(item.key)}.ics"`,
    },
  });
};
