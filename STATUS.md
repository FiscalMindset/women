# Sentinel Grid Status

Last updated: 2026-05-16 01:39 IST

## Architecture Correction

Sentinel Grid is now Kestra + frontend in the alert path. Python is used as Kestra task code or infrastructure tooling; helper registration, responder verification, live location heartbeat, dispatch, evidence processing, and reporting are Kestra-owned flows/tasks.

## Frontend-Kestra Sync

- Complete: `frontend/src/main.tsx` posts alert audio/GPS/image/profile payloads to the Kestra webhook and stores the real execution id.
- Complete: the UI polls `/kestra-api/executions/{id}` every 1 second while an execution is active.
- Fixed: Vite now rewrites `/kestra-api/executions/{id}` to `/api/v1/main/executions/{id}`. The previous non-tenant endpoint caused false “flow/execution not found” and empty topology states.
- Complete: the in-app topology maps over real Kestra `taskRunList` state and now renders node outputs under each task, not only `SUCCESS`.
- Complete: helper cards render SQLite/Kestra fields, including verification status, cybercrime status, verification source, cybercrime check timestamp, live responder GPS, distance, ETA, and selected responder state.
- Complete: victim and responder URLs are separated. Victim tracking uses `?track=...`; responder console uses `?responder=...`.
- Complete: alert history persists in browser localStorage so refresh keeps local incident links.
- Complete: responder acceptance is now Kestra-synced through `sentinel.grid.responder_accept_alert`; the victim page polls `sentinel-acceptances.json` so another browser/device can see `accepted`.
- Complete: email dispatch attaches raw WAV evidence and the latest scene image when supplied.
- Complete: users can save trusted friend emails in Emergency Profile; every alert sends them through Kestra task `dispatch_trusted_contacts` with a proper emergency subject, Google Maps location, tracking link, evidence summary, and attachments.
- Complete: trusted friend input accepts bulk emails separated by comma, semicolon, whitespace, or new lines.
- Complete: helper accepted-count and last-accepted timestamps are persisted by Kestra for future ranking/reward logic.
- Complete: admin ops page `/?admin=ops` triggers Kestra flow `admin_ops_snapshot` and reads `sentinel-admin.json`.
- Complete: saved Emergency Profile collapses into a User Account summary; edit reveals the form again.
- Complete: emergency audio capture is 8 seconds in the UI; the latest smoke used a generated 3 second WAV and Kestra reported `audio_seconds=3.0`.

Latest verified alert execution:

- Execution id: `1zV2DyRUQpFvIpXlc5lQHE`
- Flow: `sentinel.grid.sentinel_core`
- State: `SUCCESS`
- Victim tracking URL: `http://127.0.0.1:5173/?track=helper-algsoch-kumar&execution=1zV2DyRUQpFvIpXlc5lQHE`
- Responder console URL: `http://127.0.0.1:5173/?responder=helper-algsoch-kumar&execution=1zV2DyRUQpFvIpXlc5lQHE`
- Real Kestra graph: `http://127.0.0.1:8080/ui/executions/sentinel.grid/sentinel_core/1zV2DyRUQpFvIpXlc5lQHE`
- Frontend proxy verification: `http://127.0.0.1:5173/kestra-api/executions/1zV2DyRUQpFvIpXlc5lQHE` returned `SUCCESS` and the real task list.

## Helper Integrity

- Complete: helper registration goes through Kestra flow `sentinel.grid.register_responder`.
- Complete: registration now runs `verify_registered_responder_security` before SQLite upsert.
- Complete: the registration flow writes `frontend/public/sentinel-helpers.json` immediately, so refresh can show the registered helper without manual sync.
- Complete: the alert flow runs `verify_responder_security` before dispatch and removes flagged helpers from `nearest_helpers`.
- Complete: selected responder dispatch is supported. If the user clicks “Contact this responder,” the frontend sends `preferred_responder_id`; Kestra outputs `selection_mode=manual_selected_responder`.
- Complete: default dispatch remains automatic nearest responder when no manual selection is supplied.

Latest registration smoke:

- Execution id: `7i9MjXvpsJfx6NMMY2rEpJ`
- Flow revision: `3`
- State: `SUCCESS`
- Registered helper: `helper-algsoch-kumar`
- Photo normalized to: `https://github.com/fiscalmindset.png`
- Verification: `verified`
- Cybercrime: `clear`
- Verification source: `kestra_register_responder_cybercrime_auto_check_dev`
- Snapshot helpers written: `2`

## Live Location

- Complete: new Kestra flow `sentinel.grid.responder_location_ping` receives responder browser geolocation pings.
- Complete: `persist_responder_location` updates SQLite columns `latitude`, `longitude`, `location_updated_at`, `last_execution_id`, and `last_location_accuracy_m`.
- Complete: the UI polls `sentinel-helpers.json` every 3 seconds and shows the responder’s current/last known location directly in the helper card and route panel.

Latest location heartbeat smoke:

- Execution id: `1PVY0Rl56EdiGfxf1rbsNx`
- Flow revision: `2`
- State: `SUCCESS`
- Responder: `helper-algsoch-kumar`
- Location: `28.69618, 76.99798`
- Snapshot helpers written: `2`

## Responder Acceptance

- Complete: new Kestra flow `sentinel.grid.responder_accept_alert` persists acceptance to SQLite table `responder_acceptances`.
- Complete: acceptance flow updates each helper's `accepted_count` and `last_accepted_at`.
- Complete: the flow writes `frontend/public/sentinel-acceptances.json`.
- Complete: the victim UI polls this snapshot every 2 seconds and merges it with local acceptance state.

Latest acceptance smoke:

- Execution id: `5etGwpTjczzDu1ynJRfHP4`
- Flow revision: `1`
- State: `SUCCESS`
- Accepted alert execution: `1zV2DyRUQpFvIpXlc5lQHE`
- Responder: `helper-algsoch-kumar`
- Snapshot acceptance keys written: `2`
- Browser verification: victim tracking page showed `Acceptance accepted` and `accepted 01:04:00`.

Latest admin ops smoke:

- Execution id: `6g0sOrZv3pSHZsYOdtGDgN`
- Flow: `sentinel.grid.admin_ops_snapshot`
- State: `SUCCESS`
- Snapshot summary: `helpers_total=2`, `helpers_verified=2`, `helpers_flagged=0`, `acceptances_total=2`, `incidents_total=22`.
- Accepted counts: `helper-algsoch-kumar=1`, `helper-vicky-kumar=1`.

## Kestra Node Outputs From Latest Alert

- `normalize_payload`: `event_id=4c850aab92ef67fb579c11b2`, `audio_seconds=3.0`, `audio_sha256=7245f3cb83bb2be4ee189bc06592e3b88621a285a29e99ba994d77fe42bc1254`.
- `verify_distress_edge_tpu`: `audio_ai=98% Distress`, `hardware_status=CPU_FALLBACK`, `environment_sound=high ambient distress noise`.
- `verify_distress_edge_tpu`: Groq was attempted from Kestra using `.env`; result was `transcript_source=groq_failed:HTTP Error 403: Forbidden`.
- `nearest_helpers_by_radius`: `helper_count=1`, `selection_mode=manual_selected_responder`, `preferred_responder_id=helper-algsoch-kumar`, distance `0.0635 km`.
- `verify_responder_security`: `cybercrime_check=CLEAR`, `verification_mode=kestra_dev_mode_cybercrime_auto_check`, `blacklisted_count=0`.
- `persist_incident_analytics`: `area_key=delhi:28.7:77.0`.
- `dispatch_trusted_contacts`: sends trusted friend emails from the victim profile on every alert when SMTP is configured.
- `telegram_dispatch`: `telegram_status=failed`, reason `HTTP Error 401: Unauthorized`.
- `email_dispatch`: `email_status=sent` to the configured responder email.
- `anonymous_report_automation`: `report_status=draft_ready_dev_mode`.

## Cybercrime Portal Automation

- Suspect search input types: mobile, email, bank account, social media, UPI.
- Portal target: `https://cybercrime.gov.in/Webform/suspect_search_repository.aspx`.
- Anonymous report target: `https://cybercrime.gov.in/Webform/Crime_ReportAnonymously.aspx`.
- Local `dev_mode=true` records a Kestra-owned dev clear so the product path can be tested end to end without fake frontend state.
- Production path fails closed as `operator_required` when captcha/operator presence blocks automation; it does not bypass captcha.
- Report submit is controlled by Kestra variable `cybercrime_auto_submit`; current local value is `false`, so report automation creates a draft-ready result.

## Dispatch Path

- Website alert: responder console URL is emitted by Kestra in `nearest_helpers_by_radius` and rendered in the UI.
- Email alert: latest smoke returned `email_status=sent`.
- Telegram alert: latest smoke returned `HTTP Error 401: Unauthorized`; fix `.env` `TELEGRAM_BOT_TOKEN`, restart Kestra, and register a real numeric Telegram chat id after the responder starts the bot.

## Operational Analytics Plane

- Complete: Kestra task `persist_incident_analytics` writes AI-verified incident rows into SQLite table `incident_analytics`.
- Complete: the task emits a Coral-compatible SQL query shape for area-frequency analysis:

```sql
SELECT area_key, COUNT(*)
FROM incident_analytics
GROUP BY area_key
ORDER BY COUNT(*) DESC
```

## Verification

- `npm run build` passed in `frontend`.
- YAML parse passed for `flows/sentinel_core.yaml`, `flows/register_responder.yaml`, and `flows/responder_location_ping.yaml`.
- Browser verification passed on `http://127.0.0.1:5173/?track=helper-algsoch-kumar&execution=1zV2DyRUQpFvIpXlc5lQHE`: the UI showed `manual_selected_responder`, task output rows, verified-by source, cybercrime timestamp, email sent, Telegram failed, audio evidence, live route, and Kestra-synced acceptance.
