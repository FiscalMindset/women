# Sentinel Grid Build Prompt

Build Sentinel Grid as a fast human rescue mesh, not another police-style reporting app.

The product goal is: when a person is in danger, one tap captures GPS, recent audio, latest scene image, client context, and optional profile; Kestra verifies distress, verifies nearby responders, dispatches them, and both sides track acceptance and movement like a serious live delivery product.

Critical missing or fragile areas to improve next:

- Replace localStorage acceptance with a Kestra-backed acceptance webhook so victim notification works across devices, not only same browser profile.
- Add a responder mobile web app with continuous live location updates into SQLite/Kestra KV.
- Add a victim live tracking page that shows accepted responder, ETA, last responder location timestamp, and fallback contacts.
- Add real speech-to-text and environmental audio classification instead of the local placeholder transcript.
- Add secure evidence storage for raw audio/image instead of data URLs in Kestra outputs.
- Add helper onboarding with identity/KYC, consent, Cybercrime portal check, Telegram `/start` chat-id registration, and ongoing re-verification.
- Add user optional registration/profile, but keep anonymous emergency tap available.
- Add alert history backed by Kestra/SQLite so refresh and cross-device login never lose incidents.
- Fix Telegram credentials and bot registration; show delivery status per channel: website, email, Telegram.
- Add throttling, duplicate alert detection, panic follow-up prompts, and escalation if no responder accepts in N seconds.
- Keep frontend zero-fake: all execution state, task state, helper verification, dispatch status, evidence hashes, and reporting state must come from Kestra outputs or SQLite snapshots generated from the DB.

Architecture rule: product behavior must stay Kestra + frontend. Python is allowed as Kestra task code or infrastructure tooling, not as a separate feature backend.
