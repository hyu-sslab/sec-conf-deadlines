// 스키마 정의는 여기 한 곳뿐이다. 옳고 그름은 `npm run build`가 판정한다 (BR-002).
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, join, relative, sep } from 'node:path';
import { defineCollection } from 'astro:content';
import * as z from 'zod';
import { file } from 'astro/loaders';
import type { Loader } from 'astro/loaders';
import { load as parseYaml, CORE_SCHEMA } from 'js-yaml';
import { AOE } from './lib/dates.ts';

/* ------------------------------------------------------------------ *
 * YAML 파싱 정책
 *
 * js-yaml의 DEFAULT_SCHEMA는 따옴표 없는 `2026-12-15`를 JS Date로 해석한다
 * (YAML 1.1 timestamp). 그러면 기여자가 따옴표를 빠뜨렸을 때 스키마 오류가
 * 엉뚱한 모양으로 튀어나온다. CORE_SCHEMA는 timestamp 타입이 없으므로
 * 날짜는 따옴표 유무와 무관하게 항상 문자열로 들어온다.
 * ------------------------------------------------------------------ */
const YAML_OPTIONS = { schema: CORE_SCHEMA } as const;

function readYaml(filePath: string): unknown {
  const source = readFileSync(filePath, 'utf8');
  try {
    return parseYaml(source, { ...YAML_OPTIONS, filename: filePath });
  } catch (cause) {
    throw new Error(
      `YAML 구문 오류: ${filePath}\n${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
}

/* ------------------------------------------------------------------ *
 * 세부분야 태그 (FR-011)
 *
 * data/topics.yml을 여기서 직접 읽어 enum을 만든다. 정의되지 않은 태그를
 * 쓰면 학회 파일 쪽에서 빌드가 깨지고, 오류 메시지에 허용 목록이 나온다.
 * ------------------------------------------------------------------ */
const topicsFile = fileURLToPath(new URL('../data/topics.yml', import.meta.url));

const topicSchema = z.object({
  label: z.string().min(1),
  /** 필터 칩용 짧은 라벨. 칩이 화면을 넘어가지 않게 한다. */
  short: z.string().min(1),
  label_en: z.string().min(1),
  order: z.number().int().positive(),
});

const topicsDocument = z.record(z.string().regex(/^[a-z0-9-]+$/), topicSchema);
const topicsParsed = topicsDocument.safeParse(readYaml(topicsFile));

if (!topicsParsed.success) {
  throw new Error(
    `data/topics.yml 스키마 위반:\n${z.prettifyError(topicsParsed.error)}`,
  );
}

const TOPIC_IDS = Object.keys(topicsParsed.data).sort() as [string, ...string[]];

/* ------------------------------------------------------------------ *
 * 날짜 원시 타입
 *
 * 날짜는 문자열로 다룬다. Date 객체로 바꾸는 시점은 lib/dates.ts 한 곳뿐이며,
 * 여기서는 "사람이 읽는 원문 표기"를 그대로 보존한다.
 * ------------------------------------------------------------------ */
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_OR_MINUTE = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/;

/** 정규식은 2026-13-45를 걸러내지 못한다. 달력상 실재하는 날짜인지 확인한다. */
function isRealCalendarDate(value: string): boolean {
  const [datePart, timePart] = value.split(' ');
  const [y, m, d] = datePart.split('-').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== m - 1 ||
    probe.getUTCDate() !== d
  ) {
    return false;
  }
  if (timePart) {
    const [hh, mm] = timePart.split(':').map(Number);
    if (hh > 23 || mm > 59) return false;
  }
  return true;
}

const day = z
  .string()
  .regex(DAY, 'YYYY-MM-DD 형식이어야 한다')
  .refine(isRealCalendarDate, '달력에 없는 날짜다');

const dayOrMinute = z
  .string()
  .regex(DAY_OR_MINUTE, 'YYYY-MM-DD 또는 YYYY-MM-DD HH:mm 형식이어야 한다')
  .refine(isRealCalendarDate, '달력에 없는 날짜다');

/** 개최 기간. 자유 문자열을 허용하면 ICS에서 시작일을 뽑을 수 없다. */
const conferenceDate = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}( ~ \d{4}-\d{2}-\d{2})?$/,
    'YYYY-MM-DD 또는 "YYYY-MM-DD ~ YYYY-MM-DD" 형식이어야 한다',
  )
  .refine(
    (value) => value.split(' ~ ').every(isRealCalendarDate),
    '달력에 없는 날짜가 들어 있다',
  )
  .refine((value) => {
    const [start, end] = value.split(' ~ ');
    return end === undefined || start <= end;
  }, '개최 종료일이 시작일보다 빠르다');

/** IANA 타임존. 기본값은 AoE. Intl로 해석하므로 DST 지역명도 안전하다. */
const timezone = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, 'Intl이 인식하지 못하는 타임존이다');

/* ------------------------------------------------------------------ *
 * 학회 레코드 (DR-001)
 * ------------------------------------------------------------------ */
const CONFIDENCE = ['verified', 'auto', 'estimated'] as const;

const datesSchema = z.object({
  abstract: dayOrMinute.nullable(),
  /** 본문 마감. 스텁 에디션에서는 아직 null일 수 있다. */
  full_paper: dayOrMinute.nullable(),
  /** 리버탈 기간 [시작, 종료] */
  rebuttal: z.tuple([day, day]).nullable().default(null),
  /** 졸업 일정 역산의 유일한 입력값이라 키 자체를 생략할 수 없다. */
  notification: day.nullable(),
  camera_ready: day.nullable(),
});

const editionSchema = z
  .object({
    year: z.number().int().min(2000).max(2100),
    /** 다중 마감 사이클 구분 (1차/2차 라운드) */
    cycle: z.number().int().positive().default(1),
    dates: datesSchema,
    timezone: timezone.default(AOE),
    conference_date: conferenceDate.nullable().default(null),
    place: z.string().min(1).nullable().default(null),
    note: z.string().default(''),
    /** NFR-006 · DR-003 — 출처 없는 항목은 존재할 수 없다. */
    source_url: z.url(),
    last_verified_at: day,
    confidence: z.enum(CONFIDENCE),
  })
  .superRefine((edition, ctx) => {
    const { abstract, full_paper, notification, camera_ready, rebuttal } = edition.dates;

    // 사람이 확인한 레코드는 마감과 통보가 모두 채워져 있어야 한다.
    // auto/estimated는 수집 단계의 중간 상태이므로 null을 허용한다 (FR-043 스텁).
    if (edition.confidence === 'verified') {
      if (full_paper === null) {
        ctx.addIssue({
          code: 'custom',
          path: ['dates', 'full_paper'],
          message: 'confidence: verified 에디션은 본문 마감이 있어야 한다',
        });
      }
      if (notification === null) {
        ctx.addIssue({
          code: 'custom',
          path: ['dates', 'notification'],
          message:
            'confidence: verified 에디션은 통보일이 있어야 한다 (졸업 일정 역산의 입력값)',
        });
      }
    }

    // CFP의 구조상 보장되는 순서. 위반은 대개 연도 오타다.
    const ordered: Array<[string, string | null]> = [
      ['abstract', abstract],
      ['full_paper', full_paper],
      ['notification', notification],
      ['camera_ready', camera_ready],
    ];
    const present = ordered
      .filter((pair): pair is [string, string] => pair[1] !== null)
      // 날짜 부분만 비교한다. "2026-08-19 23:59" > "2026-08-19"이 되는
      // 문자열 비교의 함정 때문에 같은 날짜가 역순으로 잡히면 안 된다.
      .map(([key, value]) => [key, value.slice(0, 10)] as [string, string]);
    for (let i = 1; i < present.length; i += 1) {
      const [prevKey, prevValue] = present[i - 1];
      const [key, value] = present[i];
      if (value < prevValue) {
        ctx.addIssue({
          code: 'custom',
          path: ['dates', key],
          message: `${key}(${value})가 ${prevKey}(${prevValue})보다 빠르다`,
        });
      }
    }

    if (rebuttal && full_paper && rebuttal[0] < full_paper.slice(0, 10)) {
      ctx.addIssue({
        code: 'custom',
        path: ['dates', 'rebuttal'],
        message: '리버탈이 본문 마감보다 먼저 시작한다',
      });
    }
  });

/* ------------------------------------------------------------------ *
 * 등급 — 세 축은 서로 다른 것을 잰다 (DR-002)
 *
 *  icore    국제 통념. 추천 알고리즘(FR-022)의 등급 거리 기준.
 *  internal 교내 연도별 인정 학술대회 목록. 계수를 곱해 논문실적 %를 낸다.
 *           1~4 정수로 뭉개면 계산이 불가능해지므로 숫자를 그대로 보존한다.
 *  bk21     BK21plus 목록의 강조 여부 = "BK21PLUS 기준 SCI급 학술대회".
 *           2018-08-31 이전 발표분에 적용되는 이진값이다.
 *
 * 세 축 모두 키는 필수, 값은 nullable이다. "확인 결과 없음"과
 * "아직 안 찾아봄"이 구분되지 않으면 빈칸이 영원히 남는다.
 * ------------------------------------------------------------------ */
const ranksSchema = z.object({
  icore: z.object({
    rank: z.enum(['A*', 'A', 'B', 'C']).nullable(),
    source: z.string().min(1).nullable().default(null),
  }),
  internal: z.object({
    grade: z.enum(['A', 'B', 'C', 'D']).nullable(),
    /** 국제저명 보정IF */
    adjusted_if: z.number().positive().nullable().default(null),
    /** 국제저명 추가보정지수 */
    extra_index: z.number().positive().nullable().default(null),
    /** 국제·전문 질적보정지수 */
    quality_index: z.number().positive().nullable().default(null),
    /** 이 계수가 적용되는 목록의 연도. 만료되면 UI가 경고한다. */
    valid_year: z.number().int().min(2018).max(2100).nullable().default(null),
  }),
  bk21: z.object({
    /** BK21plus 목록에서 강조된 학회인가 */
    sci_equivalent: z.boolean().nullable(),
    code: z.string().regex(/^BKCS\d{4}$/).nullable().default(null),
  }),
});

const conferenceSchema = z
  .object({
    /** 파일명과 일치해야 한다. 추천 로직·URL의 키. */
    id: z.string().regex(/^[a-z0-9-]+$/, '소문자·숫자·하이픈만 쓸 수 있다'),
    /** 파일에서 주입된다. 학회가 직접 적는 값이 아니다. */
    category: z.string().regex(/^[a-z0-9-]+$/),
    category_label: z.string().min(1),
    category_order: z.number().int().positive(),
    name: z.string().min(1),
    full_name: z.string().min(1).nullable().default(null),
    link: z.url(),
    dblp: z.url().nullable().default(null),
    topics: z.array(z.enum(TOPIC_IDS)).min(1),
    type: z.enum(['conference', 'workshop']),
    ranks: ranksSchema,
    /** 빈 배열 = 추적 대상이나 일정 미상. "목록에 없음"과는 다르다. */
    editions: z.array(editionSchema),
  })
  .superRefine((conference, ctx) => {
    const seen = new Set<string>();
    conference.editions.forEach((edition, index) => {
      const key = `${edition.year}#${edition.cycle}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['editions', index],
          message: `${edition.year}년 ${edition.cycle}차 에디션이 중복 정의됐다`,
        });
      }
      seen.add(key);
    });
  });

/* ------------------------------------------------------------------ *
 * 카테고리 파일 로더
 *
 * 파일 1개 = 카테고리 1개이고, 그 안에 학회 여러 건이 들어간다.
 * Astro의 glob() 로더는 데이터 엔트리로 .json만 인식하므로(내장
 * dataEntryTypes) YAML을 쓰려면 로더가 필요하다.
 *
 * 학회 1개 = 파일 1개였을 때는 자동 PR이 서로 다른 파일을 건드려 충돌하지
 * 않았다. 카테고리 파일에서는 같은 카테고리의 두 학회를 동시에 고치면
 * 충돌한다 — update.py가 한 번에 한 카테고리만 잡도록 짜야 한다.
 * ------------------------------------------------------------------ */
const categoryFileSchema = z.object({
  category: z.string().regex(/^[a-z0-9-]+$/),
  label: z.string().min(1),
  label_en: z.string().min(1),
  order: z.number().int().positive(),
  conferences: z.array(z.record(z.string(), z.unknown())),
});

function yamlCategoryDirectory(relativeDir: string): Loader {
  return {
    name: 'yaml-category-loader',
    load: async ({ store, parseData, generateDigest, watcher, logger, config }) => {
      const root = fileURLToPath(config.root);
      const baseDir = fileURLToPath(new URL(relativeDir, config.root));

      // store.set은 사이트 루트 기준 POSIX 상대 경로만 받는다.
      const toStorePath = (absolute: string) =>
        relative(root, absolute).split(sep).join('/');

      const syncAll = async () => {
        store.clear();
        const files = readdirSync(baseDir)
          .filter((name) => /\.ya?ml$/.test(name))
          .sort();

        const seenIds = new Map<string, string>();
        let total = 0;

        for (const name of files) {
          const filePath = join(baseDir, name);
          const stem = basename(name).replace(/\.ya?ml$/, '');
          const parsed = categoryFileSchema.safeParse(readYaml(filePath));

          if (!parsed.success) {
            throw new Error(
              `${filePath}: 카테고리 파일 형식 위반\n${z.prettifyError(parsed.error)}`,
            );
          }

          const doc = parsed.data;
          if (doc.category !== stem) {
            throw new Error(
              `${filePath}: category가 파일명과 다르다 (파일 "${stem}" vs category "${doc.category}")`,
            );
          }

          for (const raw of doc.conferences) {
            const id = String(raw.id ?? '');
            const previous = seenIds.get(id);
            if (previous) {
              throw new Error(`학회 id "${id}"가 ${previous}와 ${name}에 중복 정의됐다`);
            }
            seenIds.set(id, name);

            const data = await parseData({
              id,
              data: {
                ...raw,
                category: doc.category,
                category_label: doc.label,
                category_order: doc.order,
              },
              filePath,
            });
            store.set({ id, data, filePath: toStorePath(filePath), digest: generateDigest(data) });
            total += 1;
          }
        }

        logger.info(`${files.length}개 카테고리에서 학회 ${total}건을 읽었다`);
      };

      await syncAll();

      if (watcher) {
        watcher.add(baseDir);
        const reload = (changed: string) => {
          if (!changed.startsWith(baseDir)) return;
          syncAll().catch((error) => logger.error(String(error)));
        };
        watcher.on('add', reload);
        watcher.on('change', reload);
        watcher.on('unlink', reload);
      }
    },
  };
}

export const collections = {
  conferences: defineCollection({
    loader: yamlCategoryDirectory('./data/conferences/'),
    schema: conferenceSchema,
  }),
  topics: defineCollection({
    loader: file('data/topics.yml'),
    schema: topicSchema,
  }),
};
