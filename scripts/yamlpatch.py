"""data/conferences/*.yml을 줄 단위로 고친다.

파싱해서 다시 쓰지 않고 바꿀 줄만 갈아끼운다. 사람이 쓴 주석을 지키고
PR diff를 읽을 수 있게 하기 위해서다.

**앵커를 못 찾으면 예외를 던진다.** 조용한 no-op을 만들지 않는다.

형식만 본다. 날짜 순서·달력 유효성은 `npm run build`가 판정한다 (BR-002).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

# 고정 들여쓰기가 곧 앵커다.
#   2  - id:  /  4  editions:  /  6  - year:  /  8  dates:  /  10  full_paper:
CONF_DASH = "  - "
EDITION_DASH = "      - "
EDITION_ITEM_INDENT = 6
EDITION_KEY_INDENT = 8
DATE_KEY_INDENT = 10

DATE_KEYS = ("abstract", "full_paper", "rebuttal", "notification", "camera_ready")
EDITION_KEYS = (
    "year",
    "cycle",
    "dates",
    "timezone",
    "conference_date",
    "place",
    "note",
    "source_url",
    "last_verified_at",
    "confidence",
)

_CONF_START = re.compile(r"^  - id:\s*(\S+)\s*$")
_EDITIONS_LINE = re.compile(r"^    editions:\s*(\[\s*\])?\s*$")
_KEY_LINE = re.compile(r"^(\s*)([A-Za-z_][A-Za-z0-9_]*):(?:\s+(.*?))?\s*$")

DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
DAY_OR_MINUTE = re.compile(r"^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$")


class AnchorError(Exception):
    """찾아야 할 자리를 못 찾았다. 부분 적용 없이 중단한다."""


# ---------------------------------------------------------------- 값 렌더링

_BARE_TOKEN = re.compile(r"^[A-Za-z0-9_+\-./:]+$")


def _quote(text: str) -> str:
    """줄바꿈은 공백으로 접는다 — note가 한 줄이어야 한다."""
    folded = " ".join(str(text).split())
    return '"' + folded.replace("\\", "\\\\").replace('"', '\\"') + '"'


def render_value(path: str, value: Any) -> str:
    """`path`(예: `dates.full_paper`)에 맞는 YAML 표기."""
    key = path.rsplit(".", 1)[-1]

    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)

    if key == "rebuttal":
        if not (isinstance(value, (list, tuple)) and len(value) == 2):
            raise ValueError(f"rebuttal은 [시작, 종료] 두 개여야 한다: {value!r}")
        return "[" + ", ".join(_quote(str(v)) for v in value) + "]"

    text = str(value)

    # 따옴표 없는 2026-12-15는 YAML 1.1 타임스탬프로 해석될 여지가 있다.
    if key in DATE_KEYS or key == "last_verified_at":
        return _quote(text)
    if key in ("source_url", "confidence", "timezone") and _BARE_TOKEN.match(text):
        return text
    return _quote(text)


def check_date_format(path: str, value: str) -> None:
    """형식만 본다. 2026-13-45는 npm run build가 잡는다."""
    key = path.rsplit(".", 1)[-1]
    if key in ("abstract", "full_paper"):
        pattern, shape = DAY_OR_MINUTE, "YYYY-MM-DD 또는 YYYY-MM-DD HH:mm"
    elif key in ("notification", "camera_ready", "last_verified_at"):
        pattern, shape = DAY, "YYYY-MM-DD"
    else:
        return
    if not pattern.match(value):
        raise ValueError(f"{path}: {shape} 형식이어야 한다 (받은 값 {value!r})")


# ---------------------------------------------------------------- 위치 찾기


@dataclass(frozen=True)
class Span:
    start: int
    end: int  # 배타적


def _indent_of(line: str) -> int:
    return len(line) - len(line.lstrip(" "))


def _is_blank(line: str) -> bool:
    return line.strip() == ""


def _normalize(line: str) -> str:
    """대시 줄을 일반 키 줄과 같은 들여쓰기로 보이게 한다."""
    if line.startswith(EDITION_DASH):
        return " " * EDITION_KEY_INDENT + line[len(EDITION_DASH) :]
    return line


def find_conference(lines: list[str], conf_id: str) -> Span:
    start = None
    for index, line in enumerate(lines):
        match = _CONF_START.match(line)
        if match and match.group(1) == conf_id:
            start = index
            break
    if start is None:
        raise AnchorError(f"학회 id `{conf_id}`를 찾지 못했다")

    for index in range(start + 1, len(lines)):
        line = lines[index]
        if _is_blank(line):
            continue
        if line.startswith(CONF_DASH) or _indent_of(line) == 0:
            return Span(start, index)
    return Span(start, len(lines))


def find_editions(lines: list[str], conf: Span) -> tuple[int, Span, bool]:
    """(`editions:` 줄 번호, 항목 영역, 빈 목록인가)."""
    header = None
    empty = False
    for index in range(conf.start, conf.end):
        match = _EDITIONS_LINE.match(lines[index])
        if match:
            header = index
            empty = match.group(1) is not None
            break
    if header is None:
        raise AnchorError("`editions:` 줄을 찾지 못했다")

    if empty:
        return header, Span(header + 1, header + 1), True

    end = header + 1
    for index in range(header + 1, conf.end):
        line = lines[index]
        if _is_blank(line):
            continue
        if _indent_of(line) < EDITION_ITEM_INDENT:
            break
        end = index + 1
    return header, Span(header + 1, end), False


def edition_spans(lines: list[str], region: Span) -> list[Span]:
    starts = [
        index
        for index in range(region.start, region.end)
        if lines[index].startswith(EDITION_DASH)
    ]
    spans = []
    for position, start in enumerate(starts):
        stop = starts[position + 1] if position + 1 < len(starts) else region.end
        while stop > start + 1 and _is_blank(lines[stop - 1]):
            stop -= 1
        spans.append(Span(start, stop))
    return spans


def edition_identity(lines: list[str], span: Span) -> tuple[int, int]:
    """(year, cycle). cycle이 없으면 스키마 기본값 1."""
    keys = scan_keys(lines, span)
    if "year" not in keys:
        raise AnchorError(f"{span.start + 1}번째 줄의 에디션에 year가 없다")
    return int(keys["year"][1]), int(keys.get("cycle", (0, "1"))[1])


def find_edition(lines: list[str], conf: Span, year: int, cycle: int) -> Span:
    _, region, empty = find_editions(lines, conf)
    if empty:
        raise AnchorError(f"{year}년 {cycle}차 에디션이 없다 (editions가 비어 있다)")
    for span in edition_spans(lines, region):
        if edition_identity(lines, span) == (year, cycle):
            return span
    raise AnchorError(f"{year}년 {cycle}차 에디션을 찾지 못했다")


def scan_keys(lines: list[str], span: Span) -> dict[str, tuple[int, str]]:
    """`key`/`dates.key` → (줄 번호, 값 원문)."""
    found: dict[str, tuple[int, str]] = {}
    in_dates = False
    for index in range(span.start, span.end):
        line = _normalize(lines[index])
        if _is_blank(line) or line.lstrip().startswith("#"):
            continue
        match = _KEY_LINE.match(line)
        if not match:
            continue
        indent, key, value = len(match.group(1)), match.group(2), match.group(3) or ""
        if indent == EDITION_KEY_INDENT:
            in_dates = key == "dates"
            found[key] = (index, value)
        elif indent == DATE_KEY_INDENT and in_dates:
            found[f"dates.{key}"] = (index, value)
    return found


# ---------------------------------------------------------------- 편집


def _insert_index(
    keys: dict[str, tuple[int, str]],
    order: tuple[str, ...],
    key: str,
    prefix: str,
    block_end: int,
) -> int:
    """키 순서를 지키는 삽입 위치. 뒤 형제 바로 앞이다."""
    position = order.index(key)
    later = [
        keys[f"{prefix}{name}"][0]
        for name in order[position + 1 :]
        if f"{prefix}{name}" in keys
    ]
    return min(later) if later else block_end


def set_value(lines: list[str], span: Span, path: str, value: Any) -> list[str]:
    """값 하나를 쓴다. 키가 없으면 제자리에 만들어 넣는다."""
    rendered = render_value(path, value)
    keys = scan_keys(lines, span)

    if path in keys:
        index, _ = keys[path]
        original = lines[index]
        key = path.rsplit(".", 1)[-1]
        if original.startswith(EDITION_DASH):
            replacement = f"{EDITION_DASH}{key}: {rendered}"
        else:
            replacement = f"{' ' * _indent_of(original)}{key}: {rendered}"
        return lines[:index] + [replacement] + lines[index + 1 :]

    if path.startswith("dates."):
        if "dates" not in keys:
            raise AnchorError("에디션에 `dates:` 블록이 없다")
        dates_line = keys["dates"][0]
        block_end = dates_line + 1
        for index in range(dates_line + 1, span.end):
            if _is_blank(lines[index]) or _indent_of(lines[index]) < DATE_KEY_INDENT:
                break
            block_end = index + 1
        at = _insert_index(
            keys, DATE_KEYS, path.split(".", 1)[1], "dates.", block_end
        )
        indent = DATE_KEY_INDENT
    else:
        at = _insert_index(keys, EDITION_KEYS, path, "", span.end)
        indent = EDITION_KEY_INDENT

    key = path.rsplit(".", 1)[-1]
    return lines[:at] + [f"{' ' * indent}{key}: {rendered}"] + lines[at:]


def render_edition(fields: dict[str, Any]) -> list[str]:
    """새 에디션 블록. 스키마의 키 순서를 따른다."""
    dates = fields.get("dates") or {}
    body: list[str] = [
        f"{EDITION_DASH}year: {render_value('year', fields['year'])}",
        f"{' ' * EDITION_KEY_INDENT}cycle: {render_value('cycle', fields.get('cycle', 1))}",
        f"{' ' * EDITION_KEY_INDENT}dates:",
    ]
    for key in DATE_KEYS:
        # rebuttal에는 스키마 기본값이 있다. 없으면 줄을 만들지 않는다.
        if key == "rebuttal" and not dates.get("rebuttal"):
            continue
        body.append(
            f"{' ' * DATE_KEY_INDENT}{key}: {render_value(f'dates.{key}', dates.get(key))}"
        )
    for key in ("timezone", "conference_date", "place", "note", "source_url",
                "last_verified_at", "confidence"):
        if key == "timezone" and not fields.get("timezone"):
            continue  # 스키마 기본값(Etc/GMT+12)에 맡긴다
        default = "" if key == "note" else None
        body.append(
            f"{' ' * EDITION_KEY_INDENT}{key}: "
            f"{render_value(key, fields.get(key, default))}"
        )
    return body


def insert_edition(lines: list[str], conf: Span, fields: dict[str, Any]) -> list[str]:
    """(year, cycle) 오름차순 자리에 끼워 넣는다."""
    year, cycle = int(fields["year"]), int(fields.get("cycle", 1))
    header, region, empty = find_editions(lines, conf)
    block = render_edition(fields)

    if empty:
        return (
            lines[:header]
            + ["    editions:"]
            + block
            + lines[header + 1 :]
        )

    for span in edition_spans(lines, region):
        if edition_identity(lines, span) == (year, cycle):
            raise AnchorError(f"{year}년 {cycle}차 에디션이 이미 있다")

    at = region.end
    for span in edition_spans(lines, region):
        if edition_identity(lines, span) > (year, cycle):
            at = span.start
            break
    return lines[:at] + block + lines[at:]
