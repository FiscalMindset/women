# Sentinel Grid Technical Design

## Mission

Sentinel Grid is designed as a real-time rescue coordination surface where the frontend is only the command surface and Kestra is the operational brain. Every important state transition should be visible as a Kestra task, Kestra output, SQLite row, or generated UI snapshot.

## System Boundaries

| Layer | Responsibility |
| --- | --- |
| React frontend | Sensor capture, tactical UI, Kestra polling, responder/victim route rendering |
| Kestra | Alert orchestration, responder verification, location heartbeat, acceptance persistence, dispatch, report drafting |
| SQLite | Operational state for responders, acceptances, incident analytics |
| Public UI snapshots | `sentinel-helpers.json` and `sentinel-acceptances.json` for browser polling |
| Services scripts | Task code used by Kestra, not a backend feature API |

## Alert Flow

```mermaid
sequenceDiagram
  participant V as Victim Browser
  participant F as React Frontend
  participant K as Kestra sentinel_core
  participant DB as SQLite sentinel.db
  participant R as Responder Browser
  participant M as Mail/Telegram

  V->>F: Tap Send Alert
  F->>F: Capture GPS, WAV audio, optional image
  F->>K: POST /kestra-webhook
  K->>K: normalize_payload
  K->>K: verify_distress_edge_tpu
  K->>DB: nearest_helpers_by_radius
  K->>K: verify_responder_security
  K->>DB: persist_incident_analytics
  K->>M: dispatch_responder_swarm
  K->>K: anonymous_report_automation
  K-->>F: execution id
  F->>K: Poll /kestra-api/executions/{id} every 1s
  F->>F: Render taskRunList state and outputs
  M-->>R: Responder console link
```

## Responder Location And Acceptance

```mermaid
flowchart LR
  R["Responder console<br/>?responder=id&execution=id"] -->|Accept Alert| A["Kestra responder_accept_alert"]
  R -->|watchPosition every ~5s| L["Kestra responder_location_ping"]
  A --> DB1["SQLite responder_acceptances"]
  L --> DB2["SQLite responders"]
  A --> AJ["frontend/public/sentinel-acceptances.json"]
  L --> HJ["frontend/public/sentinel-helpers.json"]
  AJ --> V["Victim tracking page"]
  HJ --> V
  HJ --> R
```

The responder location is not invented by the frontend. It comes from the responder browser geolocation API and is sent into Kestra, which updates SQLite and writes a UI snapshot. The victim page polls that snapshot and calculates distance/ETA client-side.

## Kestra Flow Topology

```mermaid
flowchart TD
  A["normalize_payload"] --> B["ensure_responder_integrity_schema"]
  B --> C["verify_distress_edge_tpu"]
  C --> D["nearest_helpers_by_radius"]
  D --> E{"route_verified_or_drop"}
  E -->|distress true| F["verify_responder_security"]
  F --> G["persist_incident_analytics"]
  F --> H["dispatch_responder_swarm"]
  H --> I["telegram_dispatch"]
  H --> J["email_dispatch"]
  F --> K["anonymous_report_automation"]
  E -->|distress false| L["persist_negative_validation"]
```

## Responder Verification

Registration flow:

```mermaid
flowchart TD
  UI["Helper onboarding form"] --> K["register_responder webhook"]
  K --> S["verify_registered_responder_security"]
  S -->|verified + clear| U["upsert_responder active=1"]
  S -->|flagged/operator required| X["upsert_responder active=0"]
  U --> DB["SQLite responders"]
  U --> JSON["sentinel-helpers.json"]
```

Alert-time flow:

```mermaid
flowchart TD
  N["nearest helpers"] --> C["verify_responder_security"]
  C -->|clear| D["dispatch_responder_swarm"]
  C -->|flagged| B["blacklist responder active=0"]
  B --> R["remove from nearest_helpers"]
```

Current local `dev_mode=true` records a Kestra-owned dev clear to keep the full product path testable. Production mode should use the supervised Playwright path and fail closed as `operator_required` when captcha/operator input is required.

## Execution Sync Contract

The UI reads live execution data from:

```text
/kestra-api/executions/{execution_id}
```

Vite proxies that to:

```text
/api/v1/main/executions/{execution_id}
```

The tenant-aware `/main` segment is required. Without it, Kestra can return false “flow/execution not found” responses even when the execution exists.

## Frontend State Sources

| UI Section | Source |
| --- | --- |
| Live Incident | `normalize_payload`, selected helper, acceptance snapshot |
| Kestra Outputs | Kestra task outputs |
| Rescue Route | victim GPS from execution + responder GPS from helper snapshot |
| Audio Evidence | `normalize_payload.audio_data_url`, `verify_distress_edge_tpu` outputs |
| Verified Nearby Responders | `nearest_helpers` output or `sentinel-helpers.json` |
| Responder Console | URL query + Kestra execution + helper snapshot |
| Real Kestra Topology | `taskRunList` and task output vars |

## Data Model

```mermaid
erDiagram
  responders {
    string id PK
    string telegram_chat_id
    string display_name
    float latitude
    float longitude
    boolean active
    string phone
    string email
    string github
    string photo_url
    string verification_status
    string cybercrime_status
    string cybercrime_checked_at
    string verification_source
    string location_updated_at
    string last_execution_id
    float last_location_accuracy_m
  }

  responder_acceptances {
    string execution_id PK
    string responder_id PK
    string responder_name
    string accepted_at
    float latitude
    float longitude
  }

  incident_analytics {
    string event_id PK
    string area_key
    float distress_confidence
    string hardware_status
    int created_at_epoch_ms
  }
```

## Deployment Notes

- Do not commit `.env`, SQLite data files, generated snapshots, `node_modules`, or build output.
- Kestra currently uses in-memory H2 in local Docker config, so flows must be redeployed after a container restart.
- Telegram dispatch requires a valid bot token and a real numeric chat id from a responder who has started the bot.
- Groq transcription requires a valid `GROQ_API_KEY`; failures are surfaced as `transcript_source` in Kestra outputs.

