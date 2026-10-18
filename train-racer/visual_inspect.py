#!/usr/bin/env python3
"""Visual inspection of train-racer game using Playwright"""
import asyncio
import json
import sys
from pathlib import Path
from playwright.async_api import async_playwright, expect

async def inspect_game():
    async with async_playwright() as p:
        browser = await p.chromium.launch()

        # Create a context to capture console messages and errors
        console_logs = []
        page_errors = []

        context = await browser.new_context()
        page = await context.new_page()

        # Capture console messages
        def on_console(msg):
            console_logs.append({
                'type': msg.type,
                'text': msg.text,
                'location': str(msg.location) if msg.location else None
            })

        def on_page_error(error):
            page_errors.append(str(error))

        page.on("console", on_console)
        page.on("pageerror", on_page_error)

        # Navigate to local file
        game_file = Path("c:/Users/wades/Projects/train-racer/index.html")
        file_url = game_file.as_uri()

        print(f"[INFO] Opening: {file_url}")
        await page.goto(file_url, wait_until="networkidle")

        # Wait for game to initialize (canvas should be drawn)
        await page.wait_for_timeout(2000)

        # Desktop screenshot (1280x800)
        print("[INFO] Capturing desktop screenshot...")
        await page.set_viewport_size({"width": 1280, "height": 800})
        await page.screenshot(path="desktop.png")
        print("[OK] Saved: desktop.png")

        # Mobile screenshot (375x812)
        print("[INFO] Capturing mobile screenshot...")
        await page.set_viewport_size({"width": 375, "height": 812})
        await page.screenshot(path="mobile.png")
        print("[OK] Saved: mobile.png")

        # Check canvas rendering
        canvas_check = await page.evaluate("""
            () => {
                const canvas = document.querySelector('canvas');
                if (!canvas) return { exists: false };
                const ctx = canvas.getContext('2d');
                return {
                    exists: true,
                    width: canvas.width,
                    height: canvas.height,
                    dataLength: canvas.toDataURL().length
                };
            }
        """)
        print(f"[INFO] Canvas state: {json.dumps(canvas_check, indent=2)}")

        # Get game state
        game_state = await page.evaluate("""
            () => {
                if (typeof trains !== 'undefined' && typeof ships !== 'undefined') {
                    return {
                        trainsCount: trains.length,
                        shipsCount: ships.length,
                        roadsCount: typeof roads !== 'undefined' ? roads.length : 0,
                        score: typeof score !== 'undefined' ? score : 'undefined'
                    };
                }
                return { error: 'Game globals not found' };
            }
        """)
        print(f"[INFO] Game state: {json.dumps(game_state, indent=2)}")

        # Check for overlapping elements (simple visual test)
        print("\n[CONSOLE LOGS & ERRORS]")
        if console_logs:
            for log in console_logs:
                print(f"  [{log['type'].upper()}] {log['text']}")
        if page_errors:
            for err in page_errors:
                print(f"  [ERROR] {err}")
        if not console_logs and not page_errors:
            print("  (No console errors)")

        # Cleanup
        await browser.close()

        print("\n[INSPECTION COMPLETE]")
        print("Screenshots saved: desktop.png, mobile.png")
        return {
            'console': console_logs,
            'errors': page_errors,
            'canvas': canvas_check,
            'game_state': game_state
        }

if __name__ == "__main__":
    result = asyncio.run(inspect_game())
    sys.exit(0 if not result['errors'] else 1)
