#!/usr/bin/env python3
"""수집 결과를 사람이 읽는 형태로 바꾼다.

    python3 scripts/report.py summary          # 화면 요약
    python3 scripts/report.py commit-message   # 커밋 메시지
    python3 scripts/report.py pr-body          # PR 본문
    python3 scripts/report.py failures         # 실패·차단 건 (없으면 exit 1)

`failures`의 exit 1은 의도다 — 워크플로가 그걸로 이슈 생성 여부를 가른다.
입력 리포트가 없으면 빈 결과를 낸다. 수집을 안 돌린 것도 정상이다.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
from typing import Any

ROOT = pathlib.Path(__file__).resolve().parent.parent
CACHE_DIR = ROOT / "scripts" / ".cache"
APPLY_REPORT = CACHE_DIR / "apply-report.json"
WATCH_REPORT = CACHE_DIR / "watch-report.json"


def read(path: pathlib.Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def buckets(results: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = {
        "applied": [], "same": [], "failed": [], "suggested": []
    }
    for row in results:
        outcome = row.get("outcome") or ""
        if outcome.startswith("오류") or row.get("status") in ("failed", "blocked"):
            out["failed"].append(row)
        elif row.get("changes"):
            out["applied"].append(row)
        elif outcome.startswith("거절"):
            out["failed"].append(row)
        else:
            out["same"].append(row)
        if row.get("suggestions"):
            out["suggested"].append(row)
    return out


def cmd_summary(_: argparse.Namespace) -> int:
    apply_report = read(APPLY_REPORT)
    watch_report = read(WATCH_REPORT)

    if watch_report:
        verdicts = watch_report.get("verdicts", [])
        counts = {key: 0 for key in ("same", "escalate", "blocked")}
        for verdict in verdicts:
            counts[verdict["verdict"]] = counts.get(verdict["verdict"], 0) + 1
        print(
            f"감시 {len(verdicts)}건 — 동일 {counts['same']} · "
            f"2차 판정 {counts['escalate']} · 차단 {counts['blocked']}"
        )
        for verdict in verdicts:
            if verdict["verdict"] != "same":
                print(f"  {verdict['name']}: {verdict['reason']}")
        print()

    if not apply_report:
        print("반영 리포트가 없다 (아직 apply를 돌리지 않았다).")
        return 0

    groups = buckets(apply_report.get("results", []))
    print(
        f"수집 {len(apply_report.get('results', []))}건 — "
        f"반영 {len(groups['applied'])} · 동일 {len(groups['same'])} · "
        f"실패 {len(groups['failed'])}  (기준일 {apply_report.get('collected_at')})"
    )
    for title, key in (("반영", "applied"), ("동일", "same"), ("실패", "failed")):
        if not groups[key]:
            continue
        print(f"\n{title}")
        for row in groups[key]:
            print(f"  {row['id']:<14} {row['outcome']}")
            for change in row.get("changes", []):
                print(f"      · {change}")
    if groups["suggested"]:
        print("\n사람이 판단할 것")
        for row in groups["suggested"]:
            for suggestion in row["suggestions"]:
                print(f"  {row['id']:<14} {suggestion}")
    return 0


def cmd_commit_message(_: argparse.Namespace) -> int:
    apply_report = read(APPLY_REPORT)
    groups = buckets(apply_report.get("results", []))
    applied = groups["applied"]

    if len(applied) == 1:
        print(f"data: {applied[0]['id']} 일정 갱신")
    else:
        print(f"data: 학회 {len(applied)}건 일정 갱신")
    print()
    for row in applied:
        print(f"- {row['id']}")
        for change in row.get("changes", []):
            print(f"  {change}")
    if groups["failed"]:
        print("\n반영하지 못한 건")
        for row in groups["failed"]:
            print(f"- {row['id']}: {row['outcome']}")
    print("\n자동 수집(confidence: auto)이다. 원문 대조 후 verified로 올린다.")
    return 0


def cmd_pr_body(_: argparse.Namespace) -> int:
    apply_report = read(APPLY_REPORT)
    groups = buckets(apply_report.get("results", []))

    print("자동 수집 결과다. 값과 출처를 원문과 대조한 뒤 머지한다.\n")
    if groups["applied"]:
        print("| 학회 | 바뀐 값 | 출처 |")
        print("|---|---|---|")
        for row in groups["applied"]:
            changes = "<br>".join(row.get("changes", [])) or "—"
            detail = row.get("detail") or ""
            print(f"| `{row['id']}` | {changes} | {detail} |")
        print()
    if groups["suggested"]:
        print("### 사람이 판단할 것\n")
        print("`note`는 자동으로 덮어쓰지 않는다. 아래 제안은 반영되지 **않았다**.\n")
        for row in groups["suggested"]:
            for suggestion in row["suggestions"]:
                print(f"- `{row['id']}` — {suggestion}")
        print()
    if groups["failed"]:
        print("### 반영하지 못한 건\n")
        for row in groups["failed"]:
            print(f"- `{row['id']}` — {row['outcome']}")
        print()
    print(
        "### 확인할 것\n\n"
        "- [ ] 날짜가 `source_url` 원문과 일치하는가\n"
        "- [ ] 추측으로 채워진 칸이 없는가\n"
        "- [ ] 통보일이 빠지지 않았는가 (졸업 일정 역산의 입력값)\n"
    )
    return 0


def cmd_failures(_: argparse.Namespace) -> int:
    rows = buckets(read(APPLY_REPORT).get("results", []))["failed"]
    blocked = [
        verdict
        for verdict in read(WATCH_REPORT).get("verdicts", [])
        if verdict["verdict"] == "blocked"
    ]
    if not rows and not blocked:
        return 1  # 이 값으로 워크플로가 이슈 생성을 건너뛴다

    print("자동 수집이 다음 건을 처리하지 못했다. 사람이 원문을 확인해야 한다.\n")
    for row in rows:
        print(f"- **{row['id']}** — {row['outcome']}")
        if row.get("detail"):
            print(f"  - {row['detail']}")
    for verdict in blocked:
        print(f"- **{verdict['id']}** — 감시 차단: {verdict['reason']}")
        print(f"  - {verdict['url']}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(prog="report.py", description=__doc__)
    sub = parser.add_subparsers(dest="command")
    for name, func in (
        ("summary", cmd_summary),
        ("commit-message", cmd_commit_message),
        ("pr-body", cmd_pr_body),
        ("failures", cmd_failures),
    ):
        sub.add_parser(name).set_defaults(func=func)
    args = parser.parse_args()
    return (args.func if args.command else cmd_summary)(args)


if __name__ == "__main__":
    sys.exit(main())
