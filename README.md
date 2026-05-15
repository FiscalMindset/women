# Sentinel Grid

Sentinel Grid is a Kestra-first emergency response prototype for situations where a person needs fast nearby human help before formal response teams arrive. The frontend is a tactical command surface, but orchestration, verification, dispatch, evidence handling, responder acceptance, and live location persistence are owned by Kestra flows.

The product goal is simple: a person taps an alert, the system captures location/audio/evidence, verifies distress, selects the safest nearby responder, dispatches a responder-specific console link, and lets the victim watch acceptance and movement like a live delivery handoff.

## What It Does

- Sends emergency audio, GPS, optional scene image, and optional victim profile into Kestra.
- Polls the real Kestra execution every second and renders task states from `taskRunList`.
- Shows Kestra task outputs under each topology node, not hardcoded frontend states.
- Verifies registered responders through a Kestra cybercrime/security task before SQLite activation.
- Supports manual responder selection and automatic nearest-responder dispatch.
- Tracks responder browser geolocation through a Kestra heartbeat flow.
- Persists responder acceptance through Kestra so victim and responder browsers share the same accepted state.
- Sends responder website links and email alerts with raw audio evidence and optional image evidence.
- Sends trusted friend emails saved in the victim profile on every alert through Kestra task `dispatch_trusted_contacts`.
- Tracks total accepted alerts per helper for future responder ranking and reward logic.
- Provides an admin ops view at `/?admin=ops` backed by Kestra flow `admin_ops_snapshot`.
- Keeps cybercrime report automation in draft mode by default unless the Kestra variable enables submit.

## Architecture

```mermaid
flowchart TD
  Victim["Victim browser<br/>Emergency Tap"] -->|audio + GPS + image + profile| Intake["Kestra webhook<br/>sentinel_core"]
  Intake --> Normalize["normalize_payload"]
  Normalize --> Edge["verify_distress_edge_tpu<br/>Edge TPU or CPU fallback"]
  Edge --> Helpers["nearest_helpers_by_radius<br/>SQLite responders"]
  Helpers --> Security["verify_responder_security<br/>Cybercrime check / blacklist"]
  Security --> Analytics["persist_incident_analytics<br/>SQLite analytics"]
  Security --> Trusted["dispatch_trusted_contacts<br/>friends/family email"]
  Security --> Dispatch["dispatch_responder_swarm"]
  Dispatch --> Email["email_dispatch<br/>audio + image evidence"]
  Dispatch --> Telegram["telegram_dispatch"]
  Dispatch --> ResponderURL["Responder console URL"]
  Security --> Report["anonymous_report_automation<br/>draft or submit"]
  ResponderURL --> Responder["Responder browser"]
  Responder -->|accept alert| AcceptFlow["Kestra webhook<br/>responder_accept_alert"]
  Responder -->|live GPS ping| LocationFlow["Kestra webhook<br/>responder_location_ping"]
  Admin["Admin browser<br/>?admin=ops"] --> AdminFlow["Kestra webhook<br/>admin_ops_snapshot"]
  AcceptFlow --> AcceptanceJSON["sentinel-acceptances.json"]
  LocationFlow --> HelpersJSON["sentinel-helpers.json"]
  AdminFlow --> AdminJSON["sentinel-admin.json"]
  HelpersJSON --> UI["React tactical UI"]
  AcceptanceJSON --> UI
  AdminJSON --> UI
  Intake -->|execution id| UI
  UI -->|poll every 1s| KestraAPI["/kestra-api/executions/{id}"]
  KestraAPI --> UI
```

## Kestra Flows

- `flows/sentinel_core.yaml`: main alert intake, distress validation, helper selection, responder security, dispatch, analytics, report drafting.
- `flows/register_responder.yaml`: helper onboarding through Kestra, including cybercrime/security verification before SQLite upsert.
- `flows/responder_location_ping.yaml`: responder live-location heartbeat into SQLite and the UI helper snapshot.
- `flows/responder_accept_alert.yaml`: responder acceptance persistence into SQLite and the UI acceptance snapshot.
- `flows/admin_ops_snapshot.yaml`: admin operational snapshot for responder integrity, accepted counts, recent acceptances, and incident-area analytics.

## Frontend Routes

- Victim emergency page: `http://127.0.0.1:5173/`
- Helper onboarding: `http://127.0.0.1:5173/?onboard=helper`
- Victim tracking page: `http://127.0.0.1:5173/?track=<responder_id>&execution=<execution_id>`
- Responder console: `http://127.0.0.1:5173/?responder=<responder_id>&execution=<execution_id>`
- Admin ops page: `http://127.0.0.1:5173/?admin=ops`

## Local Setup

1. Start Kestra:

```bash
docker compose up -d
```

2. Deploy flows:

```bash
KESTRA_USERNAME='admin@kestra.io' KESTRA_PASSWORD='Sentinel1' python3 infrastructure/deploy_flows.py
```

3. Start the frontend:

```bash
cd frontend
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```

4. Open the app:

```text
http://127.0.0.1:5173/
```

## Environment

Copy `.env.example` to `.env` and set local credentials. Do not commit `.env`.

Useful variables:

- `TELEGRAM_BOT_TOKEN`: Telegram dispatch token.
- `gmail`, `gmail_password`, `smtp_server`: SMTP dispatch credentials consumed by `docker-compose.yml`.
- `GROQ_API_KEY`: optional transcription key used by the Kestra distress task.
- `VITE_KESTRA_WEBHOOK_URL`: frontend alert webhook proxy path.

## Trusted Friend Notifications

On the victim emergency page, add trusted friend emails in the Emergency Profile section. Bulk entry supports commas, spaces, semicolons, or one email per line. Every alert sends those contacts to Kestra in `trusted_contacts`. The `dispatch_trusted_contacts` task emails them with:

- emergency subject including victim name and approximate coordinates,
- Google Maps location,
- victim tracking page,
- AI audio result, environment, and transcript,
- raw WAV evidence and optional scene image attachment.

This is the free notification path available today if SMTP is configured. Telegram is also free, but each friend/helper must start the bot first so the system has a real chat id. Browser push can be free too, but it requires a service worker, HTTPS hosting, and each friend subscribing before an emergency. SMS and WhatsApp usually require a paid provider for reliable automatic delivery.

## Verification

```bash
cd frontend
npm run build
```

```bash
ruby -e "require 'yaml'; %w[flows/sentinel_core.yaml flows/register_responder.yaml flows/responder_location_ping.yaml flows/responder_accept_alert.yaml].each { |f| YAML.load_file(f); puts \"ok #{f}\" }"
```

## Safety Notes

This is a prototype. Government cybercrime portals may require captcha or operator presence. The production path must fail closed as `operator_required`; it must not fake a portal clearance or bypass captcha. Real deployment also needs consent, abuse prevention, audit trails, encryption, rate limits, responder vetting, and legal review.
