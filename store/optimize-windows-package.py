"""Reduce generated Windows PNG resources, then repack with the Windows SDK.

Usage: python store/optimize-windows-package.py
Requires Pillow and Windows SDK 10.0.26100.0. Original PWABuilder files are retained.
"""

import io
import json
import re
import subprocess
import zipfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent
ARTIFACTS = ROOT / "artifacts"
SOURCE = ARTIFACTS / "windows-store"
OUTPUT = ARTIFACTS / "windows-optimized"
SDK = Path(r"C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\makeappx.exe")
LIMIT = 204800
OUTPUT.mkdir(exist_ok=True)
records = []
identity = json.loads((ROOT / "identity.json").read_text())


def prepare(data, name, version):
    folder = OUTPUT / (name + "-layout")
    folder.mkdir(exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        for item in archive.infolist():
            destination = folder / item.filename
            if not destination.resolve().is_relative_to(folder.resolve()):
                raise ValueError("Unsafe package path")
            if item.filename in ("[Content_Types].xml", "AppxBlockMap.xml", "AppxSignature.p7x"):
                continue
            if item.is_dir():
                destination.mkdir(parents=True, exist_ok=True)
                continue
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(archive.read(item))
            if item.filename == "AppxManifest.xml":
                manifest = destination.read_text(encoding="utf-8-sig")
                manifest, count = re.subn(
                    r'(<Identity\b[^>]*\bVersion=")[^"]+(")',
                    lambda match: match.group(1) + version + match.group(2),
                    manifest,
                    count=1,
                )
                assert count == 1, "Package identity version not found"
                destination.write_text(manifest, encoding="utf-8")
            if destination.suffix.lower() == ".png" and item.file_size >= LIMIT:
                with Image.open(destination) as image:
                    dimensions = image.size
                    # Retain dimensions and transparency; indexed PNG removes
                    # redundant color precision from PWABuilder's enlarged logo.
                    palette = image.convert("RGBA").quantize(
                        colors=256, method=Image.Quantize.FASTOCTREE
                    )
                    palette.save(destination, optimize=True)
                assert destination.stat().st_size < LIMIT, destination
                records.append({
                    "package": name,
                    "image": item.filename,
                    "dimensions": dimensions,
                    "originalBytes": item.file_size,
                    "optimizedBytes": destination.stat().st_size,
                })
    return folder


def run(*args):
    result = subprocess.run([str(SDK), *map(str, args)], capture_output=True, text=True)
    with (OUTPUT / "makeappx.log").open("a", encoding="utf-8") as log:
        log.write(result.stdout + result.stderr)
    result.check_returncode()


for bundle_name in ("PoKeyBoard.msixbundle", "PoKeyBoard.classic.appxbundle"):
    with zipfile.ZipFile(SOURCE / bundle_name) as bundle:
        package_names = [n for n in bundle.namelist() if n.endswith((".appx", ".msix"))]
        assert len(package_names) == 1, package_names
        package_data = bundle.read(package_names[0])
    name = "modern" if bundle_name.endswith(".msixbundle") else "classic"
    version = identity["packageVersion"] if name == "modern" else identity["classicPackageVersion"]
    layout = prepare(package_data, name, version)
    bundle_input = OUTPUT / (name + "-bundle-input")
    bundle_input.mkdir(exist_ok=True)
    run("pack", "/d", layout, "/p", bundle_input / "PoKeyBoard.appx", "/o")
    run("bundle", "/d", bundle_input, "/p", OUTPUT / bundle_name, "/bv", version, "/o")

layout = prepare((SOURCE / "PoKeyBoard.sideload.msix").read_bytes(), "sideload", identity["packageVersion"])
run("pack", "/d", layout, "/p", OUTPUT / "PoKeyBoard.sideload.msix", "/o")
(ARTIFACTS / "image-optimization.json").write_text(json.dumps(records, indent=2) + "\n")
print(json.dumps(records, indent=2))
