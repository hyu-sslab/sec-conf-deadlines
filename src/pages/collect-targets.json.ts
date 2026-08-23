/**
 * IR-001 수집 워크플로의 입력. 파일이 아니라 엔드포인트라서
 * 빌드마다 재생성되고 data/와 어긋날 수 없다.
 */
import type { APIRoute } from 'astro';
import { buildCollectPlan } from '../lib/collect.ts';
import { buildDeadlines, loadConferences } from '../lib/deadlines.ts';

export const GET: APIRoute = async () => {
  const now = new Date();
  const records = await loadConferences();
  const plan = buildCollectPlan(records, buildDeadlines(records, now), now);

  return new Response(JSON.stringify(plan, null, 2), {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
};
