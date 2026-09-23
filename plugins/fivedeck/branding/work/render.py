"""Screenshots the composed FiveDeck pages. Inlines every asset:NAME token from src/ as a data URI.

Run from plugins/fivedeck after compose.mts:
    python3 branding/work/render.py
"""
import base64
import pathlib
import re

from playwright.sync_api import sync_playwright

WORK = pathlib.Path(__file__).resolve().parent
SRC = WORK / "src"
OUT = WORK / "out"
BRANDING = WORK.parent
MIME = {".png": "image/png", ".woff2": "font/woff2", ".svg": "image/svg+xml"}


def inline(html: str) -> str:
    def replace(match):
        path = SRC / match.group(1)
        return f"data:{MIME[path.suffix]};base64," + base64.b64encode(path.read_bytes()).decode()

    return re.sub(r"asset:([A-Za-z0-9._\-]+)", replace, html)


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        executable_path="/opt/pw-browsers/chromium",
        args=["--force-color-profile=srgb", "--font-render-hinting=none"],
    )
    page = browser.new_page(viewport={"width": 1920, "height": 960}, device_scale_factor=1)
    for source in sorted(OUT.glob("*.html")):
        temporary = OUT / f"_{source.name}"
        temporary.write_text(inline(source.read_text(encoding="utf-8")), encoding="utf-8")
        page.goto(temporary.resolve().as_uri())
        page.wait_for_timeout(500)
        page.screenshot(path=str(BRANDING / f"{source.stem}.png"))
        temporary.unlink()
        print(f"Rendered {source.stem}.png")
    browser.close()
