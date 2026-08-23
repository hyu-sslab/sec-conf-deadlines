/**
 * 수집 우선순위 (IR-001) — 임박 · 예상 · 갱신 세 등급.
 *
 * D-day·KST 해석은 deadlines.ts를 그대로 쓴다. 파이썬 쪽에 같은 계산을
 * 또 만들면 어긋난다.
 */
import { KST, calendarDateIn, dDay, isPast } from './dates.ts';
import {
  compareByDeadline,
  estimateNextEdition,
  type Confidence,
  type ConferenceRecord,
  type Deadline,
} from './deadlines.ts';

export const COLLECT_POLICY = {
  /** 마감 후 2일까지 보는 이유는 연장 공지가 마감 직후에 몰리기 때문이다 (IR-002). */
  watch: { from: -2, to: 7 },
  refreshAfterDays: 30,
} as const;

export type CollectTier = 'watch' | 'projected' | 'refresh';

const TIER_PRIORITY: Record<CollectTier, 0 | 1 | 2> = {
  watch: 0,
  projected: 1,
  refresh: 2,
};

/** 원문과 대조할 기준값. */
export interface CurrentValues {
  abstract: string | null;
  full_paper: string | null;
  rebuttal: [string, string] | null;
  notification: string | null;
  camera_ready: string | null;
  conference_date: string | null;
  place: string | null;
}

export interface CollectTarget {
  /** 작업 순서. 1부터. */
  order: number;
  tier: CollectTier;
  priority: 0 | 1 | 2;

  id: string;
  name: string;
  full_name: string | null;
  category: string;
  file: string;

  /** 갱신할 에디션. null이면 새로 만들어야 한다. */
  key: string | null;
  year: number | null;
  cycle: number | null;
  timezone: string | null;

  current: CurrentValues | null;
  /** 앞에서부터 열어 본다. CFP가 먼저, 홈페이지가 다음. */
  sources: string[];
  last_verified_at: string | null;
  confidence: Confidence | null;

  dday: number | null;
  stale_days: number | null;

  /**
   * 전년도 패턴을 1년 민 값. **데이터가 아니라 검색 힌트다** —
   * 원문 확인 없이 그대로 쓰면 추정이 사실로 승격된다.
   */
  hint: { year: number; full_paper: string } | null;

  reason: string;
}

export interface CollectPlan {
  generated_at: string;
  today_kst: string;
  policy: typeof COLLECT_POLICY;
  counts: Record<CollectTier, number> & { total: number; skipped_past: number };
  targets: CollectTarget[];
}

function currentOf(item: Deadline): CurrentValues {
  return {
    abstract: item.abstract?.raw ?? null,
    full_paper: item.fullPaper?.raw ?? null,
    rebuttal: item.rebuttal,
    notification: item.notification,
    camera_ready: item.cameraReady,
    conference_date: item.conferenceDate,
    place: item.place,
  };
}

function fileOf(conference: ConferenceRecord): string {
  return `data/conferences/${conference.category}.yml`;
}

function sourcesOf(conference: ConferenceRecord, sourceUrl?: string): string[] {
  return [...new Set([sourceUrl, conference.link].filter((url): url is string => !!url))];
}

type Draft = Omit<CollectTarget, 'order'>;

function watchTarget(item: Deadline, dday: number): Draft {
  const direction = dday < 0 ? `마감 ${-dday}일 경과` : `마감 D-${dday}`;
  return {
    tier: 'watch',
    priority: TIER_PRIORITY.watch,
    id: item.conference.id,
    name: item.conference.name,
    full_name: item.conference.full_name,
    category: item.conference.category,
    file: fileOf(item.conference),
    key: item.key,
    year: item.year,
    cycle: item.cycle,
    timezone: item.timezone,
    current: currentOf(item),
    sources: sourcesOf(item.conference, item.sourceUrl),
    last_verified_at: item.lastVerifiedAt,
    confidence: item.confidence,
    dday,
    stale_days: item.staleDays,
    hint: null,
    reason: `${direction} — 연장 공지 확인`,
  };
}

function refreshTarget(item: Deadline, dday: number): Draft {
  return {
    ...watchTarget(item, dday),
    tier: 'refresh',
    priority: TIER_PRIORITY.refresh,
    reason: `D-${dday} · ${item.staleDays}일째 미확인 — 변경 여부 확인`,
  };
}

/** 레코드는 있고 마감만 비어 있다. 새로 만들지 않고 채운다. */
function stubTarget(item: Deadline): Draft {
  return {
    ...watchTarget(item, 0),
    tier: 'projected',
    priority: TIER_PRIORITY.projected,
    dday: null,
    hint: null,
    reason: `${item.year}년 에디션은 있으나 본문 마감이 비어 있다`,
  };
}

/** 다음 마감을 통째로 모르는 학회. key가 null이라 반영 단계에서 새로 만든다. */
function projectedTarget(
  conference: ConferenceRecord,
  latest: Deadline | null,
  now: Date,
): Draft {
  const estimate = estimateNextEdition(conference, now);
  const hint =
    estimate?.fullPaper !== undefined && estimate?.fullPaper !== null
      ? { year: estimate.year, full_paper: estimate.fullPaper.raw }
      : null;

  const reason = hint
    ? `다음 마감 미상 — 화면에는 ${hint.year}년 추정(${hint.full_paper.slice(0, 10)})이 뜬다`
    : latest === null
      ? '일정을 한 번도 수집하지 못했다'
      : '다음 마감 미상 — 추정할 전년도 패턴도 없다';

  return {
    tier: 'projected',
    priority: TIER_PRIORITY.projected,
    id: conference.id,
    name: conference.name,
    full_name: conference.full_name,
    category: conference.category,
    file: fileOf(conference),
    key: null,
    year: hint?.year ?? null,
    cycle: null,
    timezone: latest?.timezone ?? null,
    current: latest ? currentOf(latest) : null,
    sources: sourcesOf(conference, latest?.sourceUrl),
    last_verified_at: latest?.lastVerifiedAt ?? null,
    confidence: latest?.confidence ?? null,
    dday: null,
    stale_days: latest?.staleDays ?? null,
    hint,
    reason,
  };
}

/** 힌트가 이른 쪽을 먼저. 힌트 없는 곳은 맨 뒤로. */
function compareProjected(a: Draft, b: Draft): number {
  const left = a.hint?.full_paper ?? null;
  const right = b.hint?.full_paper ?? null;
  if (left === null && right === null) return a.id.localeCompare(b.id);
  if (left === null) return 1;
  if (right === null) return -1;
  return left === right ? a.id.localeCompare(b.id) : left < right ? -1 : 1;
}

export function buildCollectPlan(
  records: ConferenceRecord[],
  deadlines: Deadline[],
  now: Date,
): CollectPlan {
  const byConference = new Map<string, Deadline[]>();
  for (const item of deadlines) {
    const bucket = byConference.get(item.conference.id);
    if (bucket) bucket.push(item);
    else byConference.set(item.conference.id, [item]);
  }

  const drafts: Draft[] = [];
  let skippedPast = 0;

  for (const conference of records) {
    const editions = byConference.get(conference.id) ?? [];
    const stubs = editions.filter((item) => item.fullPaper === null);
    let hasFuture = false;

    for (const item of editions) {
      if (item.fullPaper === null) continue;

      const dday = dDay(item.fullPaper.instant, now, KST);

      if (dday >= COLLECT_POLICY.watch.from && dday <= COLLECT_POLICY.watch.to) {
        drafts.push(watchTarget(item, dday));
        if (!isPast(item.fullPaper.instant, now)) hasFuture = true;
        continue;
      }

      if (isPast(item.fullPaper.instant, now)) {
        skippedPast += 1;
        continue;
      }

      hasFuture = true;
      if (item.staleDays >= COLLECT_POLICY.refreshAfterDays) {
        drafts.push(refreshTarget(item, dday));
      }
    }

    for (const stub of stubs) drafts.push(stubTarget(stub));

    // 열려 있는 마감도, 채워야 할 스텁도 없을 때만 새 에디션을 찾으러 간다.
    if (!hasFuture && stubs.length === 0) {
      const latest = [...editions].sort(compareByDeadline).at(-1) ?? null;
      drafts.push(projectedTarget(conference, latest, now));
    }
  }

  drafts.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.tier === 'projected') return compareProjected(a, b);
    return (a.dday ?? 0) - (b.dday ?? 0) || a.id.localeCompare(b.id);
  });

  const targets = drafts.map((draft, index) => ({ ...draft, order: index + 1 }));
  const today = calendarDateIn(now, KST);

  return {
    generated_at: now.toISOString(),
    today_kst: `${today.year}-${String(today.month).padStart(2, '0')}-${String(today.day).padStart(2, '0')}`,
    policy: COLLECT_POLICY,
    counts: {
      watch: targets.filter((t) => t.tier === 'watch').length,
      projected: targets.filter((t) => t.tier === 'projected').length,
      refresh: targets.filter((t) => t.tier === 'refresh').length,
      total: targets.length,
      skipped_past: skippedPast,
    },
    targets,
  };
}
