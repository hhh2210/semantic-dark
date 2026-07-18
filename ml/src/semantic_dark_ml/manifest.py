from __future__ import annotations

import hashlib
import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path, PurePosixPath
from typing import Iterable, Literal, Self

SCHEMA = "semantic-dark.corpus.v1"
CorpusLabel = Literal["photo", "icon", "diagram", "screenshot", "unknown"]
TargetSplit = Literal["train", "val", "test"]
_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]*$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")


@dataclass(frozen=True, slots=True)
class CorpusRecord:
    id: str
    label: CorpusLabel
    source: str
    source_group: str
    target_split: TargetSplit
    path: str
    sha256: str
    raw_sha256: str
    original_width: int
    original_height: int
    license: str
    revision: str
    schema: str = SCHEMA

    def validate(self) -> None:
        if self.schema != SCHEMA:
            raise ValueError(f"Unsupported corpus schema: {self.schema}")
        if not _ID.fullmatch(self.id):
            raise ValueError(f"Invalid record id: {self.id!r}")
        if self.label not in {"photo", "icon", "diagram", "screenshot", "unknown"}:
            raise ValueError(f"Invalid label: {self.label}")
        if self.target_split not in {"train", "val", "test"}:
            raise ValueError(f"Invalid target split: {self.target_split}")
        relative = PurePosixPath(self.path)
        if relative.is_absolute() or ".." in relative.parts or not relative.parts:
            raise ValueError(f"Manifest path must be safe and relative: {self.path}")
        if not _SHA256.fullmatch(self.sha256) or not _SHA256.fullmatch(self.raw_sha256):
            raise ValueError(f"Invalid normalized or raw sha256 for {self.id}")
        if self.original_width <= 0 or self.original_height <= 0:
            raise ValueError(f"Invalid original dimensions for {self.id}")
        for name, value in (
            ("source", self.source),
            ("source_group", self.source_group),
            ("license", self.license),
            ("revision", self.revision),
        ):
            if not value.strip():
                raise ValueError(f"{name} is required for {self.id}")

    def to_dict(self) -> dict[str, object]:
        self.validate()
        return asdict(self)

    @classmethod
    def from_dict(cls, value: dict[str, object]) -> Self:
        record = cls(**value)  # type: ignore[arg-type]
        record.validate()
        return record


def write_manifest(records: Iterable[CorpusRecord], path: str | Path) -> int:
    manifest = Path(path)
    manifest.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with manifest.open("w", encoding="utf-8", newline="\n") as handle:
        for record in records:
            handle.write(json.dumps(record.to_dict(), sort_keys=True, separators=(",", ":")) + "\n")
            count += 1
    return count


def load_manifest(path: str | Path, *, verify_files: bool = False) -> list[CorpusRecord]:
    manifest = Path(path)
    records: list[CorpusRecord] = []
    seen_ids: set[str] = set()
    with manifest.open(encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            try:
                value = json.loads(line)
                if not isinstance(value, dict):
                    raise TypeError("record is not an object")
                record = CorpusRecord.from_dict(value)
            except (TypeError, ValueError, json.JSONDecodeError) as error:
                raise ValueError(f"Invalid manifest line {line_number}: {error}") from error
            if record.id in seen_ids:
                raise ValueError(f"Duplicate manifest id: {record.id}")
            seen_ids.add(record.id)
            if verify_files:
                file_path = (manifest.parent / record.path).resolve()
                if not file_path.is_relative_to(manifest.parent.resolve()):
                    raise ValueError(f"Record path escapes manifest root: {record.path}")
                if sha256_file(file_path) != record.sha256:
                    raise ValueError(f"Checksum mismatch: {record.path}")
            records.append(record)
    return records


def sha256_file(path: str | Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
