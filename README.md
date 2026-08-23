# [Security & Software Engineering Conference Deadlines](https://hyu-sslab.github.io/sec-conf-deadlines/)

보안·소프트웨어공학 국제 학회의 마감과 통보(notification) 일정.

---

## 학회 추가

`data/conferences/<분류>.yml`의 `conferences:` 아래에 붙여 넣고 내용을 채운 다음 PR을 올려 주세요.

<!-- prettier-ignore -->
```yaml
  - id: pets                        # 소문자·숫자·하이픈, 저장소 전체에서 유일
    name: PETS
    full_name: Privacy Enhancing Technologies Symposium
    link: https://petsymposium.org/
    dblp: https://dblp.org/db/conf/pet/index.html      # 모르면 null
    topics: [privacy, network]      # 아래 목록의 값만
    type: conference                # conference | workshop
    ranks:
      icore: { rank: "A*", source: CORE2023 }          # 모르면 rank: null
      internal: { grade: null, adjusted_if: null, extra_index: null, quality_index: null, valid_year: null }
      bk21: { sci_equivalent: null, code: null }
    editions:
      - year: 2027                  # 개최 연도 (마감 연도 아님)
        cycle: 1                    # 라운드, 2차 마감은 cycle: 2로 따로
        dates:
          abstract: "2026-11-25 23:59"
          full_paper: "2026-11-30 23:59"
          rebuttal: ["2027-01-12", "2027-01-19"]       # 기간일 때만, 하루면 note로
          notification: "2027-02-10"                   # 졸업 일정 역산의 입력값
          camera_ready: null        # 모르면 null (추측 금지)
        timezone: Etc/GMT+12        # AoE, 원문 시각 그대로
        conference_date: "2027-07-14 ~ 2027-07-18"
        place: "Zurich, Switzerland"
        note: ""
        source_url: https://petsymposium.org/cfp27.php # 그 날짜가 적힌 페이지
        last_verified_at: "2026-08-23"                 # 원문을 확인한 날
        confidence: verified        # 원문 확인했으면 verified
```

**분류** — `security-core` · `systems` · `software` · `hardware` · `ai-security` · `privacy`

**세부분야** — `systems` · `hardware` · `network` · `ai-security` · `privacy`

**날짜 형식** — `abstract`·`full_paper`는 `"YYYY-MM-DD"` 또는 `"YYYY-MM-DD HH:mm"`,
`notification`·`camera_ready`·`last_verified_at`은 `"YYYY-MM-DD"`

## 날짜 정정 · 마감 연장

해당 에디션의 `dates`를 고치고 `source_url`과 `last_verified_at`을 갱신한 다음 PR을 올려 주세요.

## PR 전

```bash
npm ci
npm run build
```

자세한 규칙은 [`CONTRIBUTING.md`](CONTRIBUTING.md)에 있습니다.
