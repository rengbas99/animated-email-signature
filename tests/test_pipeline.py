"""
tests/test_pipeline.py — pipeline + repo-hygiene checks.

Runs signature_builder.py against the committed config.json (placeholders
only) and asserts the compiled HTML is email-safe. Also asserts config.json
itself never carries real PII or leftover per-run upload caches, since a
prior session accidentally shipped a runtime cache block containing a real
name (see CLAUDE.md's whitelabeling notes) — this pins that down.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = PROJECT_ROOT / "config.json"
SIGNATURE_BUILDER = PROJECT_ROOT / "src" / "generator" / "signature_builder.py"
SIGNATURE_RAW = PROJECT_ROOT / "output" / "signature_raw.html"


def _build_signature() -> str:
    subprocess.run(
        [sys.executable, str(SIGNATURE_BUILDER)],
        cwd=PROJECT_ROOT,
        check=True,
        capture_output=True,
    )
    return SIGNATURE_RAW.read_text(encoding="utf-8")


def test_signature_html_has_no_style_or_script_tags():
    html = _build_signature()
    assert "<style" not in html.lower()
    assert "<script" not in html.lower()


def test_signature_html_is_table_rooted():
    # The template nests small <div> wrappers inside table cells (logo/name/
    # role) — that's existing, approved behavior. What matters for email
    # clients is that the outer structure is a table, not a div-based layout.
    html = _build_signature()
    assert html.strip().startswith("<table")


def test_signature_html_contains_config_values():
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    html = _build_signature()
    person = config["person"]
    assert person["name"] in html
    assert person["email"] in html
    assert person["phone"] in html


def test_signature_html_images_use_single_cdn_host_only():
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    cdn_host = re.match(r"https?://[^/]+", config["assets"]["cdn_base_url"]).group(0)
    html = _build_signature()
    for src in re.findall(r'src="([^"]+)"', html):
        assert src.startswith(cdn_host), f"image src escapes the configured CDN host: {src}"


def test_config_json_has_no_paytriot_references():
    raw = CONFIG_PATH.read_text(encoding="utf-8")
    assert "paytriot" not in raw.lower()


def test_config_json_has_no_stale_per_run_upload_caches():
    """assets.<slug>_urls blocks are runtime caches written by
    cloudinary_upload.py on each request — they must never be committed,
    since they can leak a real person's name (this happened once)."""
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    stale_keys = [k for k in config.get("assets", {}) if k.endswith("_urls")]
    assert stale_keys == [], f"found committed per-run upload cache keys: {stale_keys}"


if __name__ == "__main__":
    sys.exit(subprocess.run([sys.executable, "-m", "pytest", str(Path(__file__)), "-v"]).returncode)
