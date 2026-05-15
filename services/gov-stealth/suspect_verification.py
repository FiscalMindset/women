#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import dataclasses
import json
import os
import re
from enum import StrEnum
from typing import Any

from playwright.async_api import Browser, Page, TimeoutError as PlaywrightTimeoutError, async_playwright
from playwright_stealth import stealth_async


PORTAL_URL = "https://cybercrime.gov.in/Webform/suspect_search_repository.aspx"


class IdentifierType(StrEnum):
    MOBILE = "mobile"
    EMAIL = "email"
    BANK_ACCOUNT = "bank_account"
    SOCIAL_MEDIA = "social_media"
    UPI = "upi"


@dataclasses.dataclass(frozen=True, slots=True)
class SuspectQuery:
    identifier_type: IdentifierType
    value: str

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "SuspectQuery":
        for key in IdentifierType:
            value = payload.get(key.value)
            if isinstance(value, str) and value.strip():
                return cls(key, value.strip())
        raise ValueError("payload must include one supported suspect identifier")


async def _select_identifier(page: Page, query: SuspectQuery) -> None:
    label_map = {
        IdentifierType.MOBILE: "Mobile",
        IdentifierType.EMAIL: "E-mail",
        IdentifierType.BANK_ACCOUNT: "Bank Account",
        IdentifierType.SOCIAL_MEDIA: "Social Media",
        IdentifierType.UPI: "UPI",
    }
    dropdown = page.locator("select").first
    await dropdown.select_option(label=label_map[query.identifier_type])


async def verify(query: SuspectQuery) -> dict[str, Any]:
    headless = os.getenv("PLAYWRIGHT_HEADLESS", "true").lower() == "true"
    operator_timeout_ms = int(os.getenv("GOV_PORTAL_OPERATOR_TIMEOUT_MS", "120000"))
    async with async_playwright() as pw:
        browser: Browser = await pw.chromium.launch(headless=headless)
        context = await browser.new_context(locale="en-IN", timezone_id="Asia/Kolkata")
        page = await context.new_page()
        await stealth_async(page)
        await page.goto(PORTAL_URL, wait_until="domcontentloaded", timeout=60000)
        await _select_identifier(page, query)
        await page.get_by_role("textbox").first.fill(query.value)

        captcha = page.locator("input[id*='captcha' i], input[name*='captcha' i]").first
        if await captcha.count():
            return {
                "status": "operator_required",
                "reason": "captcha_present",
                "resume_hint": "Complete captcha in a supervised browser session, then rerun with the same payload.",
            }

        await page.get_by_role("button", name=re.compile("search", re.IGNORECASE)).click()
        try:
            await page.locator("table, .result, #result").first.wait_for(timeout=operator_timeout_ms)
        except PlaywrightTimeoutError:
            return {"status": "unknown", "reason": "result_timeout"}

        body_text = await page.locator("body").inner_text(timeout=10000)
        await browser.close()
        normalized = body_text.lower()
        return {
            "status": "match_found" if "no record" not in normalized and "not found" not in normalized else "no_match",
            "identifier_type": query.identifier_type.value,
            "details": body_text[-4000:],
        }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--payload-json", required=True)
    args = parser.parse_args()
    payload = json.loads(args.payload_json)
    print(json.dumps(asyncio.run(verify(SuspectQuery.from_payload(payload))), separators=(",", ":")))


if __name__ == "__main__":
    main()
