#!/usr/bin/env python3
"""Bounded archive inspection and extraction. Never executes archive contents.

Only regular files and directories are accepted. Limits apply cumulatively across
nested ZIP/TAR/GZIP layers, including actual streamed decompression bytes.
"""
from __future__ import annotations
import argparse
import gzip
import hashlib
import io
import json
import os
import re
import stat
import tarfile
import zipfile
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath

class UnsafeArchive(ValueError):
    pass

@dataclass(frozen=True)
class Limits:
    max_entries: int = 10000
    max_uncompressed: int = 4 * 1024**3
    max_file: int = 512 * 1024**2
    max_ratio: int = 100
    max_path_depth: int = 16
    max_archive_depth: int = 3
    max_name: int = 512

@dataclass
class Budget:
    limits: Limits
    compressed_size: int
    entries: int = 0
    expanded_bytes: int = 0
    manifest: list[dict] = field(default_factory=list)

    def entry(self):
        self.entries += 1
        if self.entries > self.limits.max_entries:
            raise UnsafeArchive("Archive entry-count limit exceeded")

    def consume(self, size: int):
        self.expanded_bytes += size
        if self.expanded_bytes > self.limits.max_uncompressed:
            raise UnsafeArchive("Archive cumulative decompression limit exceeded")
        if self.expanded_bytes > max(1, self.compressed_size) * self.limits.max_ratio:
            raise UnsafeArchive("Archive cumulative compression-ratio limit exceeded")


def safe_name(name: str, limits: Limits = Limits()) -> str:
    if not name or len(name) > limits.max_name or "\x00" in name:
        raise UnsafeArchive("Invalid archive entry name")
    if any(ord(c) < 32 or ord(c) == 127 for c in name):
        raise UnsafeArchive("Control characters in archive path")
    # Backslashes, drive paths, ADS and ambiguous platform normalization are rejected.
    if "\\" in name or ":" in name or name.startswith("/"):
        raise UnsafeArchive("Absolute, Windows or alternate-stream archive path")
    parts = name.rstrip("/").split("/")
    if not parts or len(parts) > limits.max_path_depth or any(p in ("", ".", "..") for p in parts):
        raise UnsafeArchive("Path traversal, ambiguous path or path-depth limit")
    for part in parts:
        if part != part.rstrip(" .") or re.match(r"^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)", part, re.I):
            raise UnsafeArchive("Reserved or ambiguous archive path")
    lower = "/".join(parts).lower()
    if any(marker in lower for marker in ("vbaproject.bin", "/activex/", "/embeddings/")):
        raise UnsafeArchive("Macros, ActiveX or embedded executable objects are not accepted")
    return "/".join(parts)


def kind(path: Path) -> str | None:
    with path.open("rb") as source:
        head = source.read(512)
    if head.startswith((b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08")):
        return "zip"
    if head.startswith(b"\x1f\x8b"):
        return "gzip"
    if len(head) >= 262 and head[257:262] == b"ustar":
        return "tar"
    # Old tar headers are recognized through tarfile, but never arbitrary extraction.
    if len(head) >= 512:
        try:
            with tarfile.open(path, mode="r:"):
                return "tar"
        except (tarfile.TarError, OSError):
            pass
    return None


def _write(stream, target: Path, expected: int | None, budget: Budget) -> tuple[int, str]:
    if expected is not None and (expected < 0 or expected > budget.limits.max_file):
        raise UnsafeArchive("Declared archive member size exceeds the per-file limit")
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    actual = 0
    digest = hashlib.sha256()
    # Exclusive creation rejects duplicate names, normalization collisions and overwrites.
    try:
        with target.open("xb") as output:
            while True:
                chunk = stream.read(64 * 1024)
                if not chunk:
                    break
                actual += len(chunk)
                if actual > budget.limits.max_file:
                    raise UnsafeArchive("Actual archive member size exceeds the per-file limit")
                if expected is not None and actual > expected:
                    raise UnsafeArchive("Archive member exceeds its declared size")
                budget.consume(len(chunk))
                digest.update(chunk)
                output.write(chunk)
    except FileExistsError as exc:
        raise UnsafeArchive("Duplicate archive entry or extraction collision") from exc
    if expected is not None and actual != expected:
        raise UnsafeArchive("Archive member size mismatch")
    target.chmod(0o600)
    return actual, digest.hexdigest()


def _extract(path: Path, output: Path, budget: Budget, depth: int, prefix: str) -> None:
    archive_kind = kind(path)
    if not archive_kind:
        return
    if depth > budget.limits.max_archive_depth:
        raise UnsafeArchive("Nested archive-depth limit exceeded")
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    seen: set[str] = set()
    nested: list[tuple[Path, str]] = []

    def member(name: str, stream, size: int | None, compressed: int | None = None):
        clean = safe_name(name, budget.limits)
        normalized = clean.casefold()
        if normalized in seen:
            raise UnsafeArchive("Duplicate or case-colliding archive paths")
        seen.add(normalized)
        budget.entry()
        if compressed is not None and size is not None and size > max(1, compressed) * budget.limits.max_ratio:
            raise UnsafeArchive("Archive member compression-ratio limit exceeded")
        target = output / clean
        if not target.resolve().is_relative_to(output.resolve()):
            raise UnsafeArchive("Archive path escapes extraction root")
        actual, digest = _write(stream, target, size, budget)
        logical = prefix + clean
        budget.manifest.append({"path": logical, "bytes": actual, "sha256": digest})
        nested.append((target, logical))

    if archive_kind == "zip":
        with zipfile.ZipFile(path) as archive:
            if len(archive.infolist()) + budget.entries > budget.limits.max_entries:
                raise UnsafeArchive("Archive entry-count limit exceeded")
            for info in archive.infolist():
                name = safe_name(info.filename, budget.limits)
                if info.flag_bits & 1:
                    raise UnsafeArchive("Encrypted archive member")
                mode = info.external_attr >> 16
                file_type = stat.S_IFMT(mode)
                if file_type not in (0, stat.S_IFREG, stat.S_IFDIR):
                    raise UnsafeArchive("Symlink, device or special ZIP entry")
                if info.is_dir():
                    budget.entry()
                    (output / name).mkdir(parents=True, exist_ok=True, mode=0o700)
                    continue
                if file_type == stat.S_IFDIR:
                    raise UnsafeArchive("Conflicting ZIP directory metadata")
                if info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                    raise UnsafeArchive("Unsupported ZIP compression method")
                with archive.open(info) as source:
                    member(name, source, info.file_size, info.compress_size)
    elif archive_kind == "tar":
        # Stream members instead of loading attacker-controlled metadata for every entry.
        with tarfile.open(path, mode="r|") as archive:
            for info in archive:
                name = safe_name(info.name, budget.limits)
                if info.isdir():
                    budget.entry()
                    (output / name).mkdir(parents=True, exist_ok=True, mode=0o700)
                    continue
                if not info.isfile() or info.issparse():
                    raise UnsafeArchive("TAR links, sparse files, devices and special entries are forbidden")
                source = archive.extractfile(info)
                if source is None:
                    raise UnsafeArchive("Unreadable TAR member")
                with source:
                    member(name, source, info.size)
    else:
        # The filename in a gzip header is ignored. Gzip expansion uses a generated name.
        with gzip.open(path, "rb") as source:
            member("content", source, None)
    for target, logical in nested:
        if kind(target):
            # Separate generated namespace keeps nested expansion out of uploaded paths.
            nested_root = output.parent / ("nested-" + hashlib.sha256(logical.encode()).hexdigest())
            _extract(target, nested_root, budget, depth + 1, logical + "!/")


def inspect_archive(source: Path, output: Path, limits: Limits = Limits()) -> dict:
    source = source.resolve()
    if not source.is_file():
        raise UnsafeArchive("Input must be a regular file")
    if output.exists() and any(output.iterdir()):
        raise UnsafeArchive("Extraction directory must start empty")
    budget = Budget(limits=limits, compressed_size=source.stat().st_size)
    archive_kind = kind(source)
    if archive_kind:
        _extract(source, output, budget, 1, "")
    return {"archive": archive_kind, "entries": budget.entries, "expandedBytes": budget.expanded_bytes, "files": budget.manifest}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    try:
        print(json.dumps(inspect_archive(args.source, args.output), ensure_ascii=True))
    except (UnsafeArchive, OSError, zipfile.BadZipFile, tarfile.TarError, EOFError, RuntimeError) as exc:
        print(json.dumps({"error": type(exc).__name__, "message": str(exc)}), file=__import__("sys").stderr)
        raise SystemExit(2)

if __name__ == "__main__":
    main()
