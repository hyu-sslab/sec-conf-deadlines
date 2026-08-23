#!/usr/bin/env python3
"""수집 파이프라인의 CLI (IR-001).

    python3 scripts/update.py targets [--tier T] [--limit N] [--json]
    python3 scripts/update.py apply <patch.json> [--dry-run] [--category C]

`targets`는 빌드 산출물 `dist/collect-targets.json`을 읽기만 한다. 우선순위
계산은 `src/lib/collect.ts` 한 곳에 있고 여기서 다시 구현하지 않는다.

`apply`는 수집 결과가 YAML에 닿는 **유일한 통로**이고, 다음을 강제한다.

    1. `confidence: verified` 에디션은 건드리지 않는다.
    2. 값이 없으면 기존 값을 둔다. null로 덮어쓰지 않는다.
    3. 쓴 자리에 `last_verified_at`과 `confidence: auto`를 남긴다.
    4. 한 건이라도 앵커를 못 찾으면 아무 파일도 쓰지 않고 중단한다.
    5. 의미 검증은 `npm run build`가 한다 (BR-002).
"""

from __future__ import annotations

import argparse
import difflib
import json
import pathlib
import sys
from typing import Any

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import yamlpatch as yp  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data" / "conferences"
PLAN_PATH = ROOT / "dist" / "collect-targets.json"
CACHE_DIR = ROOT / "scripts" / ".cache"

TIER_LABEL = {"watch": "임박", "projected": "예상", "refresh": "갱신"}
WRITABLE_DATES = ("abstract", "full_paper", "rebuttal", "notification", "camera_ready")
WRITABLE_FIELDS = ("conference_date", "place", "note", "timezone")

# 그 외 status는 리포트에만 남는다.
APPLIED = {"ok", "unchanged", "not_published"}
STATUSES = APPLIED | {"failed", "blocked"}


def die(message: str) -> None:
    print(f"오류: {message}", file=sys.stderr)
    raise SystemExit(1)


# ------------------------------------------------------------------ targets


def load_plan() -> dict[str, Any]:
    if not PLAN_PATH.exists():
        die(f"{PLAN_PATH.relative_to(ROOT)}가 없다. `npm run build`를 먼저 돌린다")
    return json.loads(PLAN_PATH.read_text(encoding="utf-8"))


def cmd_targets(args: argparse.Namespace) -> int:
    plan = load_plan()
    targets = plan["targets"]
    if args.tier:
        targets = [t for t in targets if t["tier"] == args.tier]
    if args.id:
        targets = [t for t in targets if t["id"] in args.id]
    if args.limit:
        targets = targets[: args.limit]

    if args.json:
        json.dump({**plan, "targets": targets}, sys.stdout, ensure_ascii=False, indent=2)
        print()
        return 0

    counts = plan["counts"]
    print(f"기준일 {plan['today_kst']} (KST)")
    print(
        f"임박 {counts['watch']} · 예상 {counts['projected']} · 갱신 {counts['refresh']}"
        f"  → 대상 {counts['total']}건, 지난 마감 {counts['skipped_past']}건 제외"
    )
    if not targets:
        print("\n대상 없음 — 할 일이 없다.")
        return 0

    print()
    for target in targets:
        edition = (
            f"{target['year']}#{target['cycle']}"
            if target["key"]
            else (f"{target['year']}년 신규" if target["year"] else "신규")
        )
        print(
            f"{target['order']:>3}. [{TIER_LABEL[target['tier']]}] "
            f"{target['name']:<14} {edition:<12} {target['category']}"
        )
        print(f"      {target['reason']}")
        print(f"      {target['sources'][0]}")
    return 0


# -------------------------------------------------------------------- apply


class Refusal(Exception):
    """규칙에 걸려 쓰지 않는다. 오류가 아니라 거절이다."""


def find_file(conf_id: str) -> pathlib.Path:
    for path in sorted(DATA_DIR.glob("*.yml")):
        lines = path.read_text(encoding="utf-8").split("\n")
        try:
            yp.find_conference(lines, conf_id)
        except yp.AnchorError:
            continue
        return path
    raise yp.AnchorError(f"학회 id `{conf_id}`가 어느 카테고리 파일에도 없다")


def validate(result: dict[str, Any]) -> None:
    if not isinstance(result.get("id"), str) or not result["id"]:
        raise ValueError("id가 없다")
    status = result.get("status")
    if status not in STATUSES:
        raise ValueError(f"status는 {sorted(STATUSES)} 중 하나여야 한다 (받은 값 {status!r})")
    if status not in APPLIED:
        return

    url = result.get("source_url")
    if not isinstance(url, str) or not url.startswith(("http://", "https://")):
        raise ValueError("source_url이 없거나 http(s)가 아니다 (NFR-006 · DR-003)")

    for key, value in (result.get("dates") or {}).items():
        if key not in WRITABLE_DATES:
            raise ValueError(f"dates.{key}는 쓸 수 없는 키다")
        if value is None or key == "rebuttal":
            continue
        yp.check_date_format(f"dates.{key}", str(value))


def plan_edits(result: dict[str, Any], collected_at: str) -> list[tuple[str, Any]]:
    """쓸 값 목록. None을 넣지 않는 것이 곧 "기존 값 보존"이다."""
    edits: list[tuple[str, Any]] = []
    for key in WRITABLE_DATES:
        value = (result.get("dates") or {}).get(key)
        if value is not None:
            edits.append((f"dates.{key}", value))
    for key in WRITABLE_FIELDS:
        value = result.get(key)
        if value is not None:
            edits.append((key, value))
    if result.get("source_url"):
        edits.append(("source_url", result["source_url"]))
    edits.append(("last_verified_at", collected_at))
    edits.append(("confidence", "auto"))
    return edits


def check_new_year(year: int, collected_at: str) -> None:
    """연도 오타로 없는 에디션이 생기는 걸 막는다."""
    now = int(collected_at[:4])
    if not (now - 1 <= year <= now + 3):
        raise ValueError(f"새 에디션 연도 {year}가 수집 시점({now})에서 너무 멀다")


def apply_to_existing(
    lines: list[str], result: dict[str, Any], collected_at: str
) -> tuple[list[str], list[str]]:
    conf_id, year = result["id"], int(result["year"])
    cycle = int(result.get("cycle", 1))

    conf = yp.find_conference(lines, conf_id)
    span = yp.find_edition(lines, conf, year, cycle)
    current = yp.scan_keys(lines, span)

    if current.get("confidence", (0, ""))[1].strip() == "verified":
        raise Refusal("confidence: verified — 사람이 확인한 값은 자동 수집이 덮지 않는다")

    changed: list[str] = []
    for path, value in plan_edits(result, collected_at):
        rendered = yp.render_value(path, value)
        before = current.get(path, (0, None))[1]
        if before is not None and before.strip() == rendered:
            continue
        # note는 사람이 쓴 판단이 쌓이는 자리다. 비어 있을 때만 기계가 채운다.
        if path == "note" and before not in (None, "", '""'):
            result.setdefault("_suggestions", []).append(f"note: {value}")
            continue
        lines = yp.set_value(lines, span, path, value)
        # 줄이 늘어났을 수 있으니 다시 찾는다.
        conf = yp.find_conference(lines, conf_id)
        span = yp.find_edition(lines, conf, year, cycle)
        current = yp.scan_keys(lines, span)
        if path not in ("last_verified_at", "confidence"):
            changed.append(f"{path}: {before or '(없음)'} → {rendered}")
    return lines, changed


def apply_as_new(
    lines: list[str], result: dict[str, Any], collected_at: str
) -> tuple[list[str], list[str]]:
    if not result.get("year"):
        raise ValueError("새 에디션에는 year가 있어야 한다")
    fields: dict[str, Any] = {
        "year": int(result["year"]),
        "cycle": int(result.get("cycle", 1)),
        "dates": {k: (result.get("dates") or {}).get(k) for k in WRITABLE_DATES},
        "conference_date": result.get("conference_date"),
        "place": result.get("place"),
        "note": result.get("note", ""),
        "timezone": result.get("timezone"),
        "source_url": result["source_url"],
        "last_verified_at": collected_at,
        "confidence": "auto",
    }
    conf = yp.find_conference(lines, result["id"])
    lines = yp.insert_edition(lines, conf, fields)
    return lines, [f"{fields['year']}년 {fields['cycle']}차 에디션 신규"]


def cmd_apply(args: argparse.Namespace) -> int:
    patch = json.loads(pathlib.Path(args.patch).read_text(encoding="utf-8"))
    collected_at = patch.get("collected_at")
    if not collected_at:
        die("패치에 collected_at(YYYY-MM-DD)이 없다")
    yp.check_date_format("last_verified_at", collected_at)

    results = patch.get("results") or []
    if not results:
        print("결과 0건 — 할 일이 없다.")
        return 0

    original: dict[pathlib.Path, list[str]] = {}
    working: dict[pathlib.Path, list[str]] = {}
    report: list[dict[str, Any]] = []
    hard_errors: list[str] = []

    for result in results:
        entry: dict[str, Any] = {
            "id": result.get("id"),
            "status": result.get("status"),
            "outcome": None,
            "changes": [],
            "suggestions": [],
            "detail": result.get("detail") or result.get("evidence"),
        }
        try:
            validate(result)
            if result["status"] not in APPLIED:
                label = {"failed": "실패", "blocked": "차단"}[result["status"]]
                entry["outcome"] = f"{label} — 데이터를 쓰지 않았다"
                report.append(entry)
                continue

            path = find_file(result["id"])
            if args.category and path.stem != args.category:
                entry["outcome"] = f"건너뜀 (--category {args.category})"
                report.append(entry)
                continue

            if path not in working:
                original[path] = path.read_text(encoding="utf-8").split("\n")
                working[path] = list(original[path])
            entry["file"] = str(path.relative_to(ROOT))

            # (year, cycle)이 이미 있으면 갱신, 없으면 새 에디션을 만든다.
            existing = False
            if result.get("year"):
                conf = yp.find_conference(working[path], result["id"])
                try:
                    yp.find_edition(
                        working[path], conf, int(result["year"]), int(result.get("cycle", 1))
                    )
                    existing = True
                except yp.AnchorError:
                    # "동일"은 대조한 에디션이 있을 때만 성립한다. 없는 걸
                    # 동일하다고 말할 수는 없으므로 새로 만들지 않는다.
                    if result["status"] == "unchanged":
                        raise ValueError(
                            f"status: unchanged인데 {result['year']}년 "
                            f"{result.get('cycle', 1)}차 에디션이 없다"
                        ) from None
                    check_new_year(int(result["year"]), collected_at)

            if existing:
                working[path], changed = apply_to_existing(
                    working[path], result, collected_at
                )
            else:
                working[path], changed = apply_as_new(working[path], result, collected_at)

            entry["changes"] = changed
            entry["suggestions"] = result.get("_suggestions", [])
            entry["outcome"] = "반영" if changed else "동일 (확인일만 갱신)"

        except Refusal as refusal:
            entry["outcome"] = f"거절 — {refusal}"
        except (yp.AnchorError, ValueError) as error:
            entry["outcome"] = f"오류 — {error}"
            hard_errors.append(f"{result.get('id')}: {error}")
        report.append(entry)

    for entry in report:
        print(f"  {str(entry['id']):<14} {str(entry['status']):<14} {entry['outcome']}")
        for change in entry["changes"]:
            print(f"      · {change}")
        for suggestion in entry.get("suggestions") or []:
            print(f"      ? 사람이 판단할 것 — {suggestion}")

    if hard_errors:
        # 부분 적용이 가장 나쁜 결과다. 한 건이라도 틀리면 통째로 되돌린다.
        print(
            f"\n오류 {len(hard_errors)}건 — 아무 파일도 쓰지 않았다. 위 목록을 고쳐 다시 돌린다.",
            file=sys.stderr,
        )
        return 1

    touched = [path for path in working if working[path] != original[path]]
    if args.dry_run:
        for path in touched:
            print(
                "\n".join(
                    difflib.unified_diff(
                        original[path],
                        working[path],
                        fromfile=str(path.relative_to(ROOT)),
                        tofile="(수집 후)",
                        lineterm="",
                        n=2,
                    )
                )
            )
            print()
        print(f"\n--dry-run: {len(touched)}개 파일이 바뀔 예정이다. 쓰지 않았다.")
        return 0

    for path in touched:
        path.write_text("\n".join(working[path]), encoding="utf-8")

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    report_path = CACHE_DIR / "apply-report.json"
    report_path.write_text(
        json.dumps(
            {"collected_at": collected_at, "results": report}, ensure_ascii=False, indent=2
        ),
        encoding="utf-8",
    )

    print(f"\n{len(touched)}개 파일 수정 · 리포트 {report_path.relative_to(ROOT)}")
    print("이제 `npm run build`로 검증한다. 실패하면 커밋하지 않는다 (BR-002).")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(prog="update.py", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    targets = sub.add_parser("targets", help="우선순위가 매겨진 수집 대상 목록")
    targets.add_argument("--tier", choices=["watch", "projected", "refresh"])
    targets.add_argument("--id", nargs="*", help="특정 학회만")
    targets.add_argument("--limit", type=int)
    targets.add_argument("--json", action="store_true")
    targets.set_defaults(func=cmd_targets)

    apply_cmd = sub.add_parser("apply", help="수집 결과를 YAML에 반영")
    apply_cmd.add_argument("patch", help="수집 결과 JSON 경로")
    apply_cmd.add_argument("--dry-run", action="store_true", help="diff만 보고 쓰지 않는다")
    apply_cmd.add_argument("--category", help="이 카테고리 파일만 고친다")
    apply_cmd.set_defaults(func=cmd_apply)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
