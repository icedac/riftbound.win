#!/usr/bin/env python3
import argparse
import hashlib
import json
import tarfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


ENTRYPOINTS = [
    "index.html",
    "cards/index.html",
    "decks/index.html",
    "playground/index.html",
    "community/index.html",
    "profile/index.html",
]


@dataclass
class PackageResult:
    archive_path: Path
    manifest_path: Path


def create_static_package(public_dir, output_dir, package_name="riftbound-static", generated_at=None):
    public_path = Path(public_dir).resolve()
    output_path = Path(output_dir).resolve()
    if not public_path.is_dir():
        raise FileNotFoundError(f"public directory not found: {public_path}")

    output_path.mkdir(parents=True, exist_ok=True)
    timestamp = generated_at or datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    safe_stamp = timestamp.replace(":", "").replace("-", "").replace("T", "-").replace("Z", "Z")
    manifest = build_manifest(public_path, package_name, timestamp)
    manifest_path = output_path / f"{package_name}-manifest.json"
    archive_path = output_path / f"{package_name}-{safe_stamp}.tar.gz"

    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    with tarfile.open(archive_path, "w:gz") as archive:
        archive.add(manifest_path, arcname="manifest.json")
        for file_path in sorted(path for path in public_path.rglob("*") if path.is_file()):
            archive.add(file_path, arcname=f"public/{file_path.relative_to(public_path).as_posix()}")

    return PackageResult(archive_path=archive_path, manifest_path=manifest_path)


def build_manifest(public_path, package_name, generated_at):
    files = [file_entry(path, public_path) for path in sorted(public_path.rglob("*")) if path.is_file()]
    cards = read_cards_json(public_path / "cards.json")
    return {
        "package_name": package_name,
        "generated_at": generated_at,
        "source_public_dir": str(public_path),
        "entrypoints": {
            entrypoint: "present" if (public_path / entrypoint).is_file() else "missing"
            for entrypoint in ENTRYPOINTS
        },
        "worker_present": (public_path / "_worker.js").is_file(),
        "cards_json_count": len(cards),
        "card_image_count": len(list((public_path / "images" / "cards").glob("*.webp"))),
        "files": files,
    }


def file_entry(path, public_path):
    return {
        "path": path.relative_to(public_path).as_posix(),
        "size": path.stat().st_size,
        "sha256": sha256(path),
    }


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_cards_json(path):
    if not path.is_file():
        return []
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    return data if isinstance(data, list) else []


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description="Package the Riftbound static site for archival or manual deploy.")
    parser.add_argument("--public-dir", default="public", help="Static site directory to package")
    parser.add_argument("--output-dir", default="dist", help="Directory for archive and manifest output")
    parser.add_argument("--name", default="riftbound-static", help="Package name prefix")
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    result = create_static_package(args.public_dir, args.output_dir, args.name)
    print(json.dumps({"archive": str(result.archive_path), "manifest": str(result.manifest_path)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
