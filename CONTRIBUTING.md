# 기여하기

데이터는 `data/conferences/<분류>.yml`에 있습니다. 이 파일을 수정해서 PR을 올려 주세요.
붙여 넣을 템플릿은 [README](README.md)에 있습니다.

| 파일 | 분류 |
|---|---|
| `security-core.yml` | 보안 코어 (S&P · CCS · USENIX Security · NDSS 등) |
| `systems.yml` | 시스템·OS |
| `software.yml` | 소프트웨어 보안 |
| `hardware.yml` | 하드웨어 보안 |
| `ai-security.yml` | AI 보안 |
| `privacy.yml` | 프라이버시·데이터 보호 |

## 값을 적을 때

- CFP 원문에 없는 값은 `null` — 작년 날짜를 옮겨 적지 않기
- `ranks`는 키를 남기고 값만 `null` — `internal`은 교내 계수라 비워도 됨
- `source_url`은 그 날짜가 적힌 페이지, `last_verified_at`은 확인한 날짜
- 원문을 직접 확인했으면 `confidence: verified` — 자동 수집이 덮어쓰지 않음
- 한 번의 PR에서는 파일 하나만 수정

## 확인

```bash
npm ci
npm run build
```

날짜 형식과 순서, 달력에 없는 날짜, `id` 중복, 정의되지 않은 `topics`를 검사.
