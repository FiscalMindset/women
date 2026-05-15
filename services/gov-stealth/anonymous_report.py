#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
from typing import Any

from playwright.async_api import TimeoutError as PlaywrightTimeoutError, async_playwright
from playwright_stealth import stealth_async


PORTAL_URL = "https://cybercrime.gov.in/Webform/Crime_ReportAnonymously.aspx"


async def file_report(payload: dict[str, Any]) -> dict[str, Any]:
    headless = os.getenv("PLAYWRIGHT_HEADLESS", "true").lower() == "true"
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=headless)
        context = await browser.new_context(locale="en-IN", timezone_id="Asia/Kolkata")
        page = await context.new_page()
        await stealth_async(page)
        await page.goto(PORTAL_URL, wait_until="domcontentloaded", timeout=60000)

        forensic = payload.get("event", payload)
        gps = forensic.get("gps", {})
        suspect = forensic.get("suspect", {})
        description = (
            f"Sentinel Grid distress event {forensic.get('event_id')}. "
            f"Audio SHA256: {forensic.get('audio_sha256')}. "
            f"Timestamp epoch ms: {forensic.get('received_at_epoch_ms')}. "
            f"GPS: {gps.get('lat')},{gps.get('lon')} accuracy={gps.get('accuracy_m')}. "
            f"Suspect: {json.dumps(suspect, ensure_ascii=False)}."
        )

        textareas = page.locator("textarea")
        if await textareas.count():
            await textareas.first.fill(description)
        for label, value in (("Latitude", gps.get("lat")), ("Longitude", gps.get("lon"))):
            if value is not None:
                candidate = page.get_by_label(label, exact=False)
                if await candidate.count():
                    await candidate.first.fill(str(value))

        captcha = page.locator("input[id*='captcha' i], input[name*='captcha' i]").first
        if await captcha.count():
            await browser.close()
            return {"status": "operator_required", "reason": "captcha_present", "draft_description": description}

        buttons = page.get_by_role("button", name=re.compile("submit|save|next", re.IGNORECASE))
        if await buttons.count():
            await buttons.first.click()
        try:
            await page.locator("text=/reference|acknowledg|submitted/i").first.wait_for(timeout=30000)
            receipt = await page.locator("body").inner_text(timeout=10000)
            status = "submitted"
        except PlaywrightTimeoutError:
            receipt = await page.locator("body").inner_text(timeout=10000)
            status = "unknown"
        await browser.close()
        return {"status": status, "receipt": receipt[-4000:]}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--payload-json", required=True)
    args = parser.parse_args()
    print(json.dumps(asyncio.run(file_report(json.loads(args.payload_json))), separators=(",", ":")))


if __name__ == "__main__":
    main()
