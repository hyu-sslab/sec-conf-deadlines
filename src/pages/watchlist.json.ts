/**
 * DR-005 — 연장 감지 워크플로(IR-002)의 입력.
 *
 * 파일이 아니라 엔드포인트다. 빌드마다 재생성되므로 원본과 어긋날 수 없다.
 * 정확한 D-오프셋 선별(D-7/D-3/D-1/D-0/D+1)은 실행 당일 watch.py가 한다.
 */
import type { APIRoute } from 'astro';
import { buildWatchlist, loadDeadlines, WATCH_WINDOW } from '../lib/deadlines.ts';

export const GET: APIRoute = async () => {
  const now = new Date();
  const items = buildWatchlist(await loadDeadlines(now), now);

  return new Response(
    JSON.stringify({ generated_at: now.toISOString(), window: WATCH_WINDOW, items }, null, 2),
    { headers: { 'content-type': 'application/json; charset=utf-8' } },
  );
};
