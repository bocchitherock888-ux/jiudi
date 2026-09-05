#!/usr/bin/env python3
"""Stage the release's verified web assets for Go embedding."""
import hashlib
import json
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parent.parent
manifest = json.loads((ROOT / "distribution/assets-manifest.json").read_text())
destination = ROOT / "distribution/runtime/assets"

for name, spec in manifest.items():
    source = ROOT / name
    if source.is_symlink() or hashlib.sha256(source.read_bytes()).hexdigest() != spec["sha256"]:
        raise SystemExit("Release asset differs from manifest: " + name)

for name in manifest:
    target = destination / name
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(ROOT / name, target)

print(f"Staged {len(manifest)} verified assets. Run Go commands in distribution/runtime.")
