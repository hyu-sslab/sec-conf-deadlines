#!/usr/bin/env python3
"""CFP 페이지 원문을 읽어 온다 (WebFetch가 막힐 때의 통로).

    python3 scripts/fetch.py <URL> [--dates] [--chars N]

usenix.org처럼 robots.txt는 허용하는데 WebFetch의 UA에만 403을 주는 곳이 있다.
여기서는 프로젝트 이름을 밝힌 UA로 요청한다.

**차단 우회 도구가 아니다.** robots.txt가 막은 경로는 여기서도 막힌다 (BR-006).
"""

from __future__ import annotations

import argparse
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from watch import Fetcher, dates_in, near_deadline  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(prog="fetch.py", description=__doc__)
    parser.add_argument("url")
    parser.add_argument("--chars", type=int, default=12000, help="출력할 본문 길이")
    parser.add_argument("--dates", action="store_true", help="날짜와 마감 문구만")
    args = parser.parse_args()

    fetcher = Fetcher()
    if not fetcher.allowed(args.url):
        print(f"robots.txt가 막는 경로다. 우회하지 않는다: {args.url}", file=sys.stderr)
        return 1

    text = fetcher.text(args.url)
    print(f"# {args.url}\n# {len(text):,}자")

    if args.dates:
        print("\n## 발견된 날짜")
        for value in sorted(dates_in(text)):
            print(f"  {value}")
        print("\n## 마감 문구 주변")
        for snippet in near_deadline(text):
            print(f"  · {snippet}")
        return 0

    print()
    print(text[: args.chars])
    if len(text) > args.chars:
        print(f"\n… {len(text) - args.chars:,}자 생략 (--chars로 늘린다)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
