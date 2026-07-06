from __future__ import annotations

import re
import sys
import zlib
from pathlib import Path

import olefile


PARA_TEXT_TAG = 67


def _is_compressed(ole: olefile.OleFileIO) -> bool:
    header = ole.openstream("FileHeader").read()
    flags = int.from_bytes(header[36:40], "little")
    return bool(flags & 1)


def _record_payloads(section: bytes):
    offset = 0
    length = len(section)
    while offset + 4 <= length:
        header = int.from_bytes(section[offset : offset + 4], "little")
        offset += 4
        tag_id = header & 0x3FF
        size = (header >> 20) & 0xFFF
        if size == 0xFFF:
            if offset + 4 > length:
                break
            size = int.from_bytes(section[offset : offset + 4], "little")
            offset += 4
        if offset + size > length:
            break
        yield tag_id, section[offset : offset + size]
        offset += size


def _clean_text(text: str) -> str:
    text = text.replace("\r", "\n")
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def extract_hwp_text(path: Path) -> str:
    ole = olefile.OleFileIO(str(path))
    compressed = _is_compressed(ole)
    section_names = sorted(
        "/".join(entry)
        for entry in ole.listdir()
        if len(entry) == 2
        and entry[0] == "BodyText"
        and entry[1].startswith("Section")
    )

    parts: list[str] = []
    for name in section_names:
        raw = ole.openstream(name).read()
        data = zlib.decompress(raw, -15) if compressed else raw
        for tag_id, payload in _record_payloads(data):
            if tag_id != PARA_TEXT_TAG:
                continue
            decoded = payload.decode("utf-16le", errors="ignore")
            cleaned = _clean_text(decoded)
            if cleaned:
                parts.append(cleaned)

    return "\n".join(parts)


def main() -> int:
    if len(sys.argv) != 3:
        print("Usage: extract_hwp_text.py input.hwp output.txt", file=sys.stderr)
        return 2
    text = extract_hwp_text(Path(sys.argv[1]))
    Path(sys.argv[2]).write_text(text, encoding="utf-8")
    print(f"Wrote {len(text)} characters to {sys.argv[2]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
