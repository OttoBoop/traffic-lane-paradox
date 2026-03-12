"""
Visual check screenshot automation for traffic_v18.html.

Takes screenshots at:
  - Start (before Play)
  - First rendered frame (~5 ticks)
  - Every 60t for 3 shots: 60, 120, 180
  - Every 120t for 3 shots: 300, 420, 540
  - Every 240t for 1 shot: 780
  - Final (sim finished or timeout)

Reads tick count from the DOM timer element (t2 = 3L sim).
No source modifications needed.
"""

import asyncio
import os
import time
from datetime import datetime
from playwright.async_api import async_playwright

HTML_PATH = os.path.join(os.path.dirname(__file__), "traffic_v18.html")
FILE_URL = "file:///" + HTML_PATH.replace("\\", "/")
OUT_DIR = os.path.join(os.path.dirname(__file__), "screenshots")
N_CARS = 40

# Tick targets: (label, tick_threshold)
TICK_TARGETS = [
    ("t001_first_frame",   5),
    ("t060",              60),
    ("t120",             120),
    ("t180",             180),
    ("t300",             300),
    ("t420",             420),
    ("t540",             540),
    ("t780",             780),
]

MAX_WALL_SECONDS = 120   # abort if simulation takes longer than 2 min real-time
POLL_MS = 80             # polling interval in ms


def ticks_from_dom(text: str) -> float:
    """Parse 'X.XXs' DOM text → ticks (multiply by 60)."""
    try:
        return float(text.strip().rstrip("s")) * 60
    except Exception:
        return 0.0


async def main():
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    out = os.path.join(OUT_DIR, f"run_{ts}")
    os.makedirs(out, exist_ok=True)
    print(f"Output: {out}")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        page = await browser.new_page(viewport={"width": 1400, "height": 860})

        await page.goto(FILE_URL)
        await page.wait_for_timeout(600)  # let build() finish

        # Set nCars=40 and rebuild
        await page.fill("#nCars", str(N_CARS))
        await page.dispatch_event("#nCars", "change")
        await page.wait_for_timeout(600)  # let rebuild() finish

        # Screenshot before Play
        path = os.path.join(out, "t000_before_play.png")
        await page.screenshot(path=path)
        print(f"[snap] t000_before_play.png")

        # Click Play
        await page.click("#bPlay")
        await page.wait_for_timeout(200)

        wall_start = time.time()
        remaining = list(TICK_TARGETS)
        done_early = False

        while remaining:
            label, target_ticks = remaining[0]

            # Poll until DOM tick passes target
            while True:
                elapsed_wall = time.time() - wall_start
                if elapsed_wall > MAX_WALL_SECONDS:
                    print(f"[timeout] wall time {elapsed_wall:.0f}s — stopping")
                    done_early = True
                    break

                timer_el = page.locator("#t2")
                timer_text = await timer_el.text_content() or "0s"
                timer_cls = await timer_el.get_attribute("class") or ""
                current_ticks = ticks_from_dom(timer_text)

                if current_ticks >= target_ticks or "done" in timer_cls:
                    break

                await asyncio.sleep(POLL_MS / 1000)

            # Take screenshot
            timer_text = await page.locator("#t2").text_content() or "0s"
            actual_ticks = ticks_from_dom(timer_text)
            path = os.path.join(out, f"{label}_actual{int(actual_ticks):05d}.png")
            await page.screenshot(path=path)
            print(f"[snap] {label} @ tick ~{int(actual_ticks)} — {os.path.basename(path)}")

            remaining.pop(0)

            if done_early:
                break

            # Check if already done
            timer_cls = await page.locator("#t2").get_attribute("class") or ""
            if "done" in timer_cls:
                print("[done] 3L simulation finished")
                break

        # Final screenshot
        timer_text = await page.locator("#t2").text_content() or "0s"
        actual_ticks = ticks_from_dom(timer_text)
        path = os.path.join(out, f"tFINAL_actual{int(actual_ticks):05d}.png")
        await page.screenshot(path=path)
        print(f"[snap] FINAL @ tick ~{int(actual_ticks)} — {os.path.basename(path)}")

        print(f"\nDone. {len(os.listdir(out))} screenshots in:\n  {out}")
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
