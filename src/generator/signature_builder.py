"""
signature_builder.py — HTML email signature table builder.

Reads config.json and renders the Jinja2 template to produce a
pure table-based inline-CSS HTML string safe for all email clients.

Usage:
    python3 src/generator/signature_builder.py

Output:
    output/signature_raw.html  (the embeddable signature fragment)
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, select_autoescape

PROJECT_ROOT = Path(__file__).resolve().parents[2]
CONFIG_PATH = PROJECT_ROOT / "config.json"
TEMPLATE_DIR = PROJECT_ROOT / "src" / "templates"
OUTPUT_DIR = PROJECT_ROOT / "output"


def load_config() -> dict[str, Any]:
    """Load and return the project config.json."""
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def build_social_icons_html(config: dict[str, Any]) -> str:
    """Generate the social icons row HTML from config social links.

    Skips any social platform with an empty URL.

    Args:
        config: Parsed config.json dict.

    Returns:
        HTML string of linked social icon images.
    """
    social = config["social"]
    brand = config["brand"]
    cdn = config["assets"]["cdn_base_url"]

    # Map platform names to their hosted icon URLs (icons8 CDN — no tracking)
    icon_map = {
        "linkedin": f"https://img.icons8.com/ios-filled/32/{brand['accent_color'].lstrip('#')}/linkedin.png",
        "twitter": f"https://img.icons8.com/ios-filled/32/{brand['accent_color'].lstrip('#')}/twitter.png",
        "github": f"https://img.icons8.com/ios-filled/32/{brand['accent_color'].lstrip('#')}/github.png",
        "website": f"https://img.icons8.com/ios-filled/32/{brand['accent_color'].lstrip('#')}/domain.png",
    }

    icons_html = []
    for platform, url in social.items():
        if not url:
            continue
        icon_url = icon_map.get(platform)
        if not icon_url:
            continue
        label = platform.capitalize()
        icons_html.append(
            f'<a href="{url}" target="_blank" '
            f'style="text-decoration:none;color:{brand["primary_color"]};display:inline-block;margin-right:6px;">'
            f'<img src="{icon_url}" width="16" height="16" alt="{label}" '
            f'style="display:block;border:0;outline:0;" /></a>'
        )

    return "".join(icons_html)


def render_signature(config: dict[str, Any]) -> str:
    """Render the signature HTML table from the Jinja2 template.

    Args:
        config: Parsed config.json dict.

    Returns:
        Fully rendered HTML string (the signature fragment only).
    """
    env = Environment(
        loader=FileSystemLoader(str(TEMPLATE_DIR)),
        autoescape=select_autoescape(["html"]),
    )
    template = env.get_template("signature.html.jinja")

    cdn = config["assets"]["cdn_base_url"]
    slug = config.get("person", {}).get("slug", "")
    logo_url = config.get("assets", {}).get("logo_url") or (cdn + "company-logo.png")
    social_icons_html = build_social_icons_html(config)
    photo = resolve_photo_style(config)

    ctx = {
        "person": config["person"],
        "brand": config["brand"],
        "copy_text": config["copy_text"],
        "logo_url": logo_url,
        "social_icons_html": social_icons_html,
        "social": config["social"],
        "config": config,
        "sig_width": config["output"]["signature_width"],
        "logo_height": config["output"]["logo_height"],
        
        # Inject detailed / social icons
        "linkedin_icon_url": cdn + "linkedin-icon.gif",
        "website_icon_url": cdn + "website-icon.gif",
        "message_icon_url": cdn + "message-icon.gif",
        "office_icon_url": cdn + "office-icon.png",
        "mail_icon_url": cdn + "mail-icon.png",
        "phone_icon_url": cdn + "phone-icon.png",
        "map_icon_url": cdn + "map-icon.png",
        
        # Photo-style driven values (Parallelogram / 3 Strips / Circle)
        "photo_style": photo["style"],
        "photo_url": photo["url"],
        "photo_w": photo["width"],
        "photo_h": photo["height"],
        "photo_is_circle": photo["is_circle"],
    }

    return template.render(**ctx)


def resolve_photo_style(config: dict[str, Any]) -> dict[str, Any]:
    """Resolve the configured photo style to a hosted GIF and cell dimensions.

    The three styles mirror the interactive builder's photo treatments. Because
    email clients cannot run CSS ``clip-path`` animations, each style references
    a pre-rendered GIF on the CDN:

      * ``circle`` → ``avatar_circle.gif`` (always produced by gif_maker.py).
      * ``para``   → ``avatar_para.gif`` (Puppeteer capture).
      * ``strips`` → ``avatar_strips.gif`` (Puppeteer capture).

    Args:
        config: Parsed config.json dict.

    Returns:
        Dict with keys ``style``, ``url``, ``width``, ``height`` and
        ``is_circle`` for use as template context.
    """
    cdn = config["assets"]["cdn_base_url"]
    out = config["output"]
    style = config.get("photo_style", "circle").lower()
    slug = config.get("person", {}).get("slug", "")

    avatar_size = out["avatar_size"]
    photo_w = out.get("photo_width", 200)
    photo_h = out.get("photo_height", 160)

    prefix = f"{slug}_" if slug else ""

    style_map: dict[str, tuple[str, int, int, bool]] = {
        "circle": (f"{prefix}avatar_circle.gif", avatar_size, avatar_size, True),
        "para": (f"{prefix}avatar_para.gif", photo_w, photo_h, False),
        "strips": (f"{prefix}avatar_strips.gif", photo_w, photo_h, False),
    }
    filename, width, height, is_circle = style_map.get(style, style_map["circle"])

    # Attempt to resolve from Cloudinary uploaded manifest cache if present
    slug_urls = config.get("assets", {}).get(f"{slug}_urls", {})
    if style in slug_urls:
        photo_url = slug_urls[style]
    else:
        photo_url = cdn + filename

    return {
        "style": style,
        "url": photo_url,
        "width": width,
        "height": height,
        "is_circle": is_circle,
    }


def strip_comments(html: str) -> str:
    """Remove HTML comments from a string (not needed in final sig output).

    Args:
        html: Raw HTML string.

    Returns:
        HTML with <!-- ... --> comments removed (preserves MSO conditionals).
    """
    import re
    # Keep MSO conditional comments, strip regular ones
    html = re.sub(r"<!--(?!\[if).*?-->", "", html, flags=re.DOTALL)
    return html


def main() -> None:
    """Entry point — render and save the signature HTML fragment."""
    OUTPUT_DIR.mkdir(exist_ok=True)
    config = load_config()

    print("🏗  Building HTML signature...")
    html = render_signature(config)
    html = strip_comments(html)

    out_path = OUTPUT_DIR / "signature_raw.html"
    out_path.write_text(html, encoding="utf-8")

    size_kb = len(html.encode("utf-8")) / 1024
    print(f"  ✅ Signature HTML saved: {out_path} ({size_kb:.1f} KB)")


if __name__ == "__main__":
    main()
