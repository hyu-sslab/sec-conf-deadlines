---
description: 학회 마감 데이터를 우선순위대로 한 번에 수집해 반영한다 (IR-001)
argument-hint: "[--tier watch|projected|refresh] [--limit N] [--id ccs ndss]"
allowed-tools: Read, Glob, Grep, WebFetch, WebSearch, Write(scripts/.cache/**), Bash(npm run build), Bash(python3 scripts/update.py:*), Bash(python3 scripts/watch.py:*), Bash(python3 scripts/fetch.py:*), Bash(python3 scripts/report.py:*)
---

# /collect — 마감 데이터 수집

관리자가 치는 명령은 이것 하나다. 대상 선정 → 원문 수집 → 반영 → 검증까지 간다.

인자: `$ARGUMENTS` (없으면 전체)

---

## 1. 대상 산출

```bash
npm run build
python3 scripts/update.py targets $ARGUMENTS
```

우선순위는 `src/lib/collect.ts`가 정한다. **순서를 임의로 바꾸지 않는다.**

1. **임박** `watch` — D-7~D+2. 연장 공지가 몰리는 구간이라 시간이 없다
2. **예상** `projected` — 다음 마감 미상. 화면의 추정을 실물로 바꾸는, 가치가 가장 큰 일
3. **갱신** `refresh` — 30일 이상 미확인인 확정 미래 마감

대상이 0건이면 **여기서 끝낸다.** 할 일이 없는 게 정상이다.

## 2. 임박 건 1차 판정 (LLM 없이)

`watch` 등급이 있으면 먼저 돌린다. 저장된 날짜가 원문에 그대로 있으면 그걸로 끝이다.

```bash
python3 scripts/watch.py
```

`scripts/.cache/watch-report.json`을 읽는다.

- `same` → **원문을 열지 않는다.** 결과에 `status: unchanged`로만 넣는다
- `escalate` → 3단계에서 원문을 직접 읽는다 (`snippets`·`candidates`가 단서다)
- `blocked` → `status: blocked`로 기록하고 넘어간다

## 3. 원문 수집

남은 대상을 **`targets` 출력 순서 그대로** 처리한다.

- 대상의 `sources[0]`(CFP)을 먼저 열고, 없으면 `sources[1]`(홈페이지)에서 CFP를 찾는다
- `WebFetch`가 403이면 → `python3 scripts/fetch.py <URL> --dates`
- CFP 페이지 자체를 못 찾겠으면 `WebSearch`로 `"<학회명> <연도> call for papers"`
- `projected` 대상의 `hint`는 **검색 힌트일 뿐 데이터가 아니다.** 원문에 없으면 안 쓴다

한 건 끝날 때마다 결과를 누적한다. `id` 하나가 실패해도 나머지는 계속한다.

## 4. 결과 파일 작성

`scripts/.cache/patch.json`에 쓴다. **`data/`를 직접 고치지 않는다** — 권한이 없고,
규칙 검사를 건너뛰게 되기 때문이다.

```json
{
  "collected_at": "YYYY-MM-DD",
  "results": [
    {
      "id": "ccs",
      "year": 2027,
      "cycle": 1,
      "status": "ok",
      "source_url": "https://www.sigsac.org/ccs/CCS2027/callforpapers.html",
      "dates": {
        "abstract": "2027-01-08 23:59",
        "full_paper": "2027-01-15 23:59",
        "notification": "2027-04-10"
      },
      "conference_date": "2027-11-08 ~ 2027-11-12",
      "place": "Seoul, Korea",
      "timezone": "Etc/GMT+12",
      "note": "2차 라운드는 CFP 미공개.",
      "evidence": "Paper submission deadline: January 15, 2027 (AoE)"
    },
    { "id": "nsdi", "status": "blocked", "detail": "HTTP 403" }
  ]
}
```

- 못 찾은 키는 **넣지 않는다.** `null`을 쓰지 않는다 (기존 값을 지우게 된다)
- `year`는 **개최 연도**다. 마감 연도가 아니다
- `evidence`에 근거 문장을 원문 그대로 넣는다
- `last_verified_at`·`confidence`는 쓰지 않는다. `apply`가 붙인다

### 추출 규칙

**추측하지 않는다.** CFP에 없는 날짜는 넣지 않는다. 전년도 값을 그대로 옮기지 않는다.
`projected` 대상의 `hint`는 검색 힌트일 뿐이며, 원문에 없으면 쓰지 않는다.

| 필드 | 형식 |
|---|---|
| `abstract` · `full_paper` | `YYYY-MM-DD` 또는 `YYYY-MM-DD HH:mm` |
| `notification` · `camera_ready` | `YYYY-MM-DD` (시각은 버린다) |
| `rebuttal` | `["YYYY-MM-DD", "YYYY-MM-DD"]` — **기간일 때만**. 하루면 `note`로 |
| `conference_date` | `YYYY-MM-DD` 또는 `YYYY-MM-DD ~ YYYY-MM-DD` |

- **타임존을 환산하지 않는다.** 원문의 벽시계 시각을 그대로 쓰고 `timezone`에 IANA
  이름을 적는다. AoE면 기본값(`Etc/GMT+12`)이라 생략한다.
- `11:59 pm` → `23:59`, `noon` → `12:00`. 시각이 없으면 날짜만.
- **통보일이 최우선이다.** 졸업 일정 역산의 유일한 입력값이다. CFP에 없으면
  홈페이지의 Important Dates·Timeline까지 확인한다.
- 여러 라운드를 받는 학회는 라운드마다 별도 에디션이다. `cycle: 1`, `cycle: 2` …
  원문 순서(Spring/Fall)를 따르고 어느 라운드인지 `note`에 적는다.

| 상황 | `status` | 결과 |
|---|---|---|
| 정상 수집 | `ok` | 값 반영 |
| 원문과 저장값이 같음 | `unchanged` | `last_verified_at`만 갱신 |
| 페이지는 열리나 일정 미공개 | `not_published` | 날짜가 `null`인 에디션 스텁 |
| 파싱 실패·판단 불가 | `failed` | 아무것도 안 쓴다 |
| robots.txt·HTTP 차단 | `blocked` | 아무것도 안 쓴다 |

**스텁은 관측의 결과일 때만 만든다.** "페이지를 봤는데 날짜가 없더라"는 사실이다.
전년도 +1년 추정은 화면이 빌드 타임에 계산하므로 파일에 쓰지 않는다.

| 도메인 | 상태 | 대응 |
|---|---|---|
| `usenix.org` | `WebFetch`만 403 | `python3 scripts/fetch.py <URL> --dates` |
| `acsac.org` | robots.txt가 검색엔진 외 전부 차단 | `blocked`. 사람이 확인한다 |
| `portal.core.edu.au` | AI 에이전트를 `Disallow: /` | 여기서 수집하지 않는다 (IR-003) |

## 5. 반영

```bash
python3 scripts/update.py apply scripts/.cache/patch.json --dry-run
python3 scripts/update.py apply scripts/.cache/patch.json
```

`--dry-run` diff를 먼저 보고, 의도한 줄만 바뀌는지 확인한 뒤 실제로 반영한다.
오류가 한 건이라도 있으면 **아무 파일도 쓰이지 않는다.** 그 건을 고쳐 다시 돌린다.

## 6. 검증

```bash
npm run build
```

실패하면 **되돌린다.** 잘못된 데이터를 커밋하지 않는다 (BR-002).
날짜 순서 오류는 대개 연도를 잘못 읽은 경우다. 원문을 다시 확인한다.

## 7. 보고

```bash
python3 scripts/report.py summary
```

이 출력을 그대로 사람에게 보인다. 형식은 이렇게 나온다.

```
수집 12건 · 반영 9 · 동일 2 · 실패 1

반영
  CCS 2027#1      마감 2027-01-15, 통보 2027-04-10  (신규)
  NDSS 2027#2     마감 2026-08-19 → 2026-09-02      (연장)
동일
  USENIX Sec 2027#1, WWW 2027#1
실패
  NSDI            HTTP 403 — 사람이 확인해야 한다
사람이 판단할 것
  EuroSys 2027#1  note 제안: "…"
```

`main`에 직접 커밋하지 않는다. 브랜치를 파고 PR로 올린다 (BR-003 · FR-044).

```bash
git switch -c auto/collect-$(date +%Y%m%d)
```

커밋 메시지에 **바뀐 값과 출처**를 적는다. 리뷰어가 원문을 다시 열지 않아도 되게.

---

## 하지 않을 것

- CFP에 없는 날짜를 채우지 않는다. 전년도 값을 그대로 옮기지 않는다
- 실패를 넘기지 않는다. `status: failed`로 남기고 보고에 올린다
- `robots.txt`를 우회하지 않는다. UA를 위장하지 않는다 (BR-006)
- 등급(`ranks`)은 건드리지 않는다. ICORE는 IR-003의 몫이다
