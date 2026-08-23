#!/usr/bin/env python3
"""마감 연장 감지 (IR-002 · FR-041).

    python3 scripts/watch.py [--tier watch] [--all] [--webhook URL]

대상이 0건이면 즉시 끝난다 (FR-042).

**1차 판정에 LLM을 쓰지 않는다.** 묻는 것은 "저장된 마감일이 지금도 그 페이지에
적혀 있는가" 하나뿐이다. 어느 날짜가 진짜 마감인지 정규식으로 맞히려 들지
않는다 — 틀리면 조용히 틀린 값을 심는다.

    same       원문에 그대로 있다 → 할 일 없음
    escalate   다르거나 못 읽었다 → Claude 2차 판정
    blocked    robots.txt·HTTP로 열 수 없다 → 사람이 확인

BR-006: robots.txt를 따르고 도메인당 1초 이상 띄운다. UA를 위장하지 않는다.
"""

from __future__ import annotations

import argparse
import html
import json
import pathlib
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
from typing import Any

ROOT = pathlib.Path(__file__).resolve().parent.parent
PLAN_PATH = ROOT / "dist" / "collect-targets.json"
CACHE_DIR = ROOT / "scripts" / ".cache"

# 신원을 밝힌다. 브라우저인 척하지 않는다 (BR-006).
# 이름·버전은 package.json에서 읽는다 — 포크하거나 버전을 올릴 때 여기를 또 고치지 않도록.
def _user_agent() -> str:
    try:
        meta = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        name, version = meta["name"], meta["version"]
    except Exception:
        return "sec-conf-deadlines (+https://github.com/hyu-sslab/sec-conf-deadlines)"
    return f"{name}/{version} (+https://github.com/hyu-sslab/{name})"


USER_AGENT = _user_agent()
REQUEST_INTERVAL = 1.0
TIMEOUT = 20
MAX_BYTES = 3_000_000

EXTENSION_WORDS = ("extended", "extension", "deadline has been", "연장")

MONTHS = {
    name: number
    for number, names in enumerate(
        [
            ("jan", "january"), ("feb", "february"), ("mar", "march"),
            ("apr", "april"), ("may",), ("jun", "june"),
            ("jul", "july"), ("aug", "august"), ("sep", "sept", "september"),
            ("oct", "october"), ("nov", "november"), ("dec", "december"),
        ],
        start=1,
    )
    for name in names
}
_MONTH_ALT = "|".join(sorted(MONTHS, key=len, reverse=True))

_ISO = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")
_MDY = re.compile(
    rf"\b({_MONTH_ALT})\.?\s+(\d{{1,2}})(?:st|nd|rd|th)?,?\s+(\d{{4}})\b", re.I
)
_DMY = re.compile(
    rf"\b(\d{{1,2}})(?:st|nd|rd|th)?\s+({_MONTH_ALT})\.?,?\s+(\d{{4}})\b", re.I
)
_SCRIPT = re.compile(r"(?is)<(script|style|noscript)\b.*?</\1>")
_TAG = re.compile(r"(?s)<[^>]+>")


def die(message: str) -> None:
    print(f"오류: {message}", file=sys.stderr)
    raise SystemExit(2)


# ---------------------------------------------------------------- 네트워크


class Fetcher:
    """robots.txt를 지키고 도메인당 간격을 두는 fetcher."""

    def __init__(self) -> None:
        self._robots: dict[str, urllib.robotparser.RobotFileParser | None] = {}
        self._delay: dict[str, float] = {}
        self._last: dict[str, float] = {}

    def _wait(self, host: str) -> None:
        # Crawl-delay가 기본값보다 길면 그쪽을 따른다 (BR-006).
        interval = max(REQUEST_INTERVAL, self._delay.get(host, 0.0))
        elapsed = time.monotonic() - self._last.get(host, 0.0)
        if elapsed < interval:
            time.sleep(interval - elapsed)
        self._last[host] = time.monotonic()

    def _open(self, url: str) -> str:
        request = urllib.request.Request(
            url, headers={"User-Agent": USER_AGENT, "Accept": "text/html,*/*"}
        )
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            raw = response.read(MAX_BYTES)
            charset = response.headers.get_content_charset() or "utf-8"
        return raw.decode(charset, errors="replace")

    def allowed(self, url: str) -> bool:
        """robots.txt를 우리 UA로 직접 받아 판정한다.

        `RobotFileParser.read()`를 쓰면 안 된다 — 파이썬 기본 UA로 요청하고,
        그 UA를 막는 사이트의 403을 **전부 금지**로 해석한다 (usenix.org가 그렇다).
        """
        parts = urllib.parse.urlsplit(url)
        origin = f"{parts.scheme}://{parts.netloc}"
        if origin not in self._robots:
            self._wait(parts.netloc)
            parser: urllib.robotparser.RobotFileParser | None = None
            try:
                parser = urllib.robotparser.RobotFileParser()
                parser.parse(self._open(f"{origin}/robots.txt").splitlines())
                delay = parser.crawl_delay(USER_AGENT)
                if delay:
                    self._delay[parts.netloc] = float(delay)
            except Exception:
                # 못 읽은 것은 금지가 아니다 (RFC 9309는 4xx를 "제한 없음"으로 본다).
                # 정말 막힌 곳이면 본문 요청이 403으로 알려 준다.
                parser = None
            self._robots[origin] = parser
        parser = self._robots[origin]
        return True if parser is None else parser.can_fetch(USER_AGENT, url)

    def text(self, url: str) -> str:
        self._wait(urllib.parse.urlsplit(url).netloc)
        markup = self._open(url)
        stripped = _TAG.sub(" ", _SCRIPT.sub(" ", markup))
        return re.sub(r"\s+", " ", html.unescape(stripped))


# ---------------------------------------------------------------- 날짜 추출


def _iso(year: str | int, month: str | int, day: str | int) -> str | None:
    year, month, day = int(year), int(month), int(day)
    if not (1 <= month <= 12 and 1 <= day <= 31):
        return None
    return f"{year:04d}-{month:02d}-{day:02d}"


def dates_in(text: str) -> set[str]:
    """여러 표기의 날짜를 YYYY-MM-DD로 모은다."""
    found: set[str] = set()
    for year, month, day in _ISO.findall(text):
        if value := _iso(year, month, day):
            found.add(value)
    for month, day, year in _MDY.findall(text):
        if value := _iso(year, MONTHS[month.lower()], day):
            found.add(value)
    for day, month, year in _DMY.findall(text):
        if value := _iso(year, MONTHS[month.lower()], day):
            found.add(value)
    return found


def near_deadline(text: str, limit: int = 6) -> list[str]:
    """마감 문구 주변만 잘라 낸다. 2차 판정의 입력이다."""
    snippets = []
    for match in re.finditer(
        r"(?i)(submission deadline|paper deadline|papers? due|abstract deadline"
        r"|full paper|deadline|due date)",
        text,
    ):
        start = max(0, match.start() - 90)
        snippets.append(text[start : match.end() + 130].strip())
        if len(snippets) >= limit:
            break
    return snippets


# ------------------------------------------------------------------ 판정


def inspect(target: dict[str, Any], fetcher: Fetcher) -> dict[str, Any]:
    stored = (target.get("current") or {}).get("full_paper")
    verdict: dict[str, Any] = {
        "id": target["id"],
        "name": target["name"],
        "key": target["key"],
        "year": target["year"],
        "cycle": target["cycle"],
        "dday": target["dday"],
        "stored_deadline": stored,
        "url": target["sources"][0],
        "verdict": "escalate",
        "reason": "",
        "candidates": [],
        "snippets": [],
    }

    url = verdict["url"]
    try:
        if not fetcher.allowed(url):
            verdict.update(verdict="blocked", reason="robots.txt가 이 경로를 막는다")
            return verdict
        text = fetcher.text(url)
    except urllib.error.HTTPError as error:
        verdict.update(verdict="blocked", reason=f"HTTP {error.code}")
        return verdict
    except Exception as error:
        verdict.update(verdict="escalate", reason=f"가져오기 실패: {error}")
        return verdict

    found = dates_in(text)
    lowered = text.lower()
    extension_hint = any(word in lowered for word in EXTENSION_WORDS)
    verdict["candidates"] = sorted(found)[:12]
    verdict["extension_hint"] = extension_hint

    if stored is None:
        verdict["reason"] = "저장된 마감이 없어 대조할 기준이 없다"
        verdict["snippets"] = near_deadline(text)
        return verdict

    day = stored[:10]
    if day in found:
        if extension_hint:
            verdict["reason"] = "날짜는 그대로지만 연장 문구가 보인다"
            verdict["snippets"] = near_deadline(text)
            return verdict
        verdict.update(verdict="same", reason=f"{day}가 원문에 그대로 있다")
        return verdict

    if not found:
        verdict["reason"] = "원문에서 날짜를 하나도 못 찾았다 (JS 렌더링 가능성)"
    else:
        verdict["reason"] = f"{day}가 원문에 없다 — 바뀌었을 수 있다"
    verdict["snippets"] = near_deadline(text)
    return verdict


def notify(webhook: str, changed: list[dict[str, Any]]) -> None:
    """연장 의심 건을 즉시 알린다 (FR-045)."""
    lines = [
        f"• {item['name']} {item['year']} (D{item['dday']:+d}) — {item['reason']}\n  {item['url']}"
        for item in changed
    ]
    payload = json.dumps(
        {"text": "마감 변경 의심 " + str(len(changed)) + "건\n" + "\n".join(lines)}
    ).encode("utf-8")
    request = urllib.request.Request(
        webhook,
        data=payload,
        headers={"Content-Type": "application/json", "User-Agent": USER_AGENT},
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            print(f"알림 전송: HTTP {response.status}")
    except Exception as error:
        print(f"알림 전송 실패: {error}", file=sys.stderr)


def write_report(plan: dict[str, Any], verdicts: list[dict[str, Any]]) -> pathlib.Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = CACHE_DIR / "watch-report.json"
    path.write_text(
        json.dumps(
            {"generated_at": plan["generated_at"], "verdicts": verdicts},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    return path


def main() -> int:
    parser = argparse.ArgumentParser(prog="watch.py", description=__doc__)
    parser.add_argument("--tier", default="watch", choices=["watch", "projected", "refresh"])
    parser.add_argument("--all", action="store_true", help="모든 등급을 본다")
    parser.add_argument("--id", nargs="*", help="특정 학회만")
    parser.add_argument("--webhook", help="연장 의심 시 POST할 URL (FR-045)")
    args = parser.parse_args()

    if not PLAN_PATH.exists():
        die(f"{PLAN_PATH.relative_to(ROOT)}가 없다. `npm run build`를 먼저 돌린다")
    plan = json.loads(PLAN_PATH.read_text(encoding="utf-8"))

    targets = plan["targets"]
    if not args.all:
        targets = [t for t in targets if t["tier"] == args.tier]
    if args.id:
        targets = [t for t in targets if t["id"] in args.id]

    # 0건이어도 리포트를 새로 쓴다. 안 그러면 지난 실행의 판정이 남아
    # report.py와 CI가 옛 결과를 지금 것으로 착각한다.
    if not targets:
        write_report(plan, [])
        print("감시 대상 0건 — 종료")
        return 0

    print(f"감시 대상 {len(targets)}건 (기준일 {plan['today_kst']} KST)")
    fetcher = Fetcher()
    verdicts = [inspect(target, fetcher) for target in targets]

    mark = {"same": "동일", "escalate": "2차 판정 필요", "blocked": "차단"}
    for verdict in verdicts:
        print(f"  {verdict['name']:<18} {mark[verdict['verdict']]:<14} {verdict['reason']}")

    report = write_report(plan, verdicts)

    escalate = [v for v in verdicts if v["verdict"] == "escalate"]
    blocked = [v for v in verdicts if v["verdict"] == "blocked"]
    print(
        f"\n동일 {len(verdicts) - len(escalate) - len(blocked)} · "
        f"2차 판정 {len(escalate)} · 차단 {len(blocked)}"
        f"  → {report.relative_to(ROOT)}"
    )

    if escalate and args.webhook:
        notify(args.webhook, escalate)
    if escalate:
        print("2차 판정이 필요하다. `/collect --tier watch`로 원문을 읽는다.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
