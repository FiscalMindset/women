import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Activity, CheckCircle2, Database, ExternalLink, FileAudio, History, MapPin, Navigation, Radio, Route, ShieldAlert, UserPlus, UserRound, Volume2 } from "lucide-react";
import "./styles.css";

type GpsFix = { lat: number; lon: number; accuracy_m: number | null };
type HelperMatch = {
  id: string;
  name?: string;
  display_name?: string;
  email?: string | null;
  phone?: string | null;
  github?: string | null;
  photo_url?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  distance_km?: number | null;
  distance_km2?: number | null;
  active?: boolean | number;
  verification_status?: string | null;
  cybercrime_status?: string | null;
  cybercrime_checked_at?: string | null;
  blacklist_reason?: string | null;
  responder_console_url?: string | null;
  verification_source?: string | null;
  location_updated_at?: string | null;
  accepted_count?: number | null;
  last_accepted_at?: string | null;
};
type TaskOutputs = Record<string, unknown> & { rows?: HelperMatch[]; nearest_helpers?: HelperMatch[]; checked_helpers?: HelperMatch[]; vars?: TaskOutputs };
type TaskRun = { id?: string; taskId?: string; state?: { current?: string }; outputs?: TaskOutputs; attempts?: { state?: { current?: string } }[] };
type ExecutionResponse = { id?: string; flowRevision?: number; state?: { current?: string }; taskRunList?: TaskRun[] };
type HelperSnapshot = { helpers?: HelperMatch[] };
type AcceptanceMetric = { accepted_count?: number; last_accepted_at?: string | null };
type AcceptanceSnapshot = { acceptances?: Record<string, string>; acceptance_counts?: Record<string, AcceptanceMetric> };
type HelperRegistrationPosition = { lat: number; lon: number; accuracy_m: number | null; source: string };
type DispatchState = {
  count: number;
  activeExecutionId: string | null;
  lastResult: string;
  execution: ExecutionResponse | null;
  helpers: HelperMatch[];
};
type AlertHistoryItem = { executionId: string; createdAt: string; responderId?: string; responderName?: string; state?: string; victimGps?: GpsFix | null };
type VictimProfile = { name: string; phone: string; emergencyContact: string; trustedContacts: string; notes: string };
type HelperRegistration = { display_name: string; phone: string; email: string; github: string; photo_url: string };
type AdminSnapshot = {
  generated_at?: string;
  summary?: Record<string, number>;
  helpers?: HelperMatch[];
  acceptances?: Array<Record<string, unknown>>;
  incident_analytics?: Array<Record<string, unknown>>;
  top_areas?: Array<Record<string, unknown>>;
};

const KESTRA_WEBHOOK_URL = import.meta.env.VITE_KESTRA_WEBHOOK_URL || "/kestra-webhook";
const KESTRA_REGISTER_HELPER_URL = import.meta.env.VITE_KESTRA_REGISTER_HELPER_URL || "/kestra-register-helper";
const KESTRA_LOCATION_PING_URL = import.meta.env.VITE_KESTRA_LOCATION_PING_URL || "/kestra-location-ping";
const KESTRA_ACCEPT_ALERT_URL = import.meta.env.VITE_KESTRA_ACCEPT_ALERT_URL || "/kestra-accept-alert";
const KESTRA_ADMIN_SNAPSHOT_URL = import.meta.env.VITE_KESTRA_ADMIN_SNAPSHOT_URL || "/kestra-admin-snapshot";
const KESTRA_API_BASE = "/kestra-api";
const KESTRA_UI_BASE = import.meta.env.VITE_KESTRA_UI_BASE || `${window.location.protocol}//${window.location.hostname || "localhost"}:8080`;
const KESTRA_BASIC_AUTH_TOKEN = import.meta.env.VITE_KESTRA_BASIC_AUTH_TOKEN || "YWRtaW5Aa2VzdHJhLmlvOlNlbnRpbmVsMQ==";
const TERMINAL_STATES = new Set(["SUCCESS", "FAILED", "WARNING", "KILLED", "CANCELLED"]);
const ACCEPTANCE_PREFIX = "sentinel-acceptance:";
const ALERT_HISTORY_KEY = "sentinel-alert-history";
const VICTIM_PROFILE_KEY = "sentinel-victim-profile";
const HELPER_REGISTRATION_KEY = "sentinel-helper-registration";

function App(): React.ReactElement {
  const params = new URLSearchParams(window.location.search);
  const [armed, setArmed] = useState(false);
  const [arming, setArming] = useState(false);
  const [gps, setGps] = useState<GpsFix | null>(null);
  const [status, setStatus] = useState("idle");
  const [detail, setDetail] = useState("One tap sends GPS and audio evidence into Kestra. The command surface follows the live execution every second.");
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [alertHistory, setAlertHistory] = useState<AlertHistoryItem[]>([]);
  const [victimProfile, setVictimProfile] = useState<VictimProfile>(() => normalizeVictimProfile(readJson<Partial<VictimProfile>>(VICTIM_PROFILE_KEY, {})));
  const [helperRegistration, setHelperRegistration] = useState<HelperRegistration>(() => readJson(HELPER_REGISTRATION_KEY, { display_name: "", phone: "", email: "", github: "", photo_url: "" }));
  const [profileStatus, setProfileStatus] = useState("saved profile will attach to future alerts");
  const [profileExpanded, setProfileExpanded] = useState(() => !localStorage.getItem(VICTIM_PROFILE_KEY));
  const [registrationStatus, setRegistrationStatus] = useState("not submitted");
  const [snapshotHelpers, setSnapshotHelpers] = useState<HelperMatch[]>([]);
  const [acceptanceCounts, setAcceptanceCounts] = useState<Record<string, AcceptanceMetric>>({});
  const [adminSnapshot, setAdminSnapshot] = useState<AdminSnapshot | null>(null);
  const [adminStatus, setAdminStatus] = useState("admin snapshot pending");
  const [selectedResponderId, setSelectedResponderId] = useState<string | null>(() => params.get("track") ?? null);
  const [locationPingStatus, setLocationPingStatus] = useState("location ping pending");
  const [dispatch, setDispatch] = useState<DispatchState>({ count: 0, activeExecutionId: null, lastResult: "none", execution: null, helpers: [] });
  const [acceptedBy, setAcceptedBy] = useState<Record<string, string>>({});
  const responderId = params.get("responder");
  const trackingResponderId = params.get("track");
  const executionFromUrl = params.get("execution");
  const isResponderMode = Boolean(responderId);
  const isHelperOnboarding = params.get("onboard") === "helper" || params.get("register") === "helper";
  const isAdminMode = params.get("admin") === "ops";
  const isVictimTrackingMode = Boolean(trackingResponderId && executionFromUrl);
  const showEmergencySetup = !isResponderMode && !isHelperOnboarding && !isVictimTrackingMode && !isAdminMode;
  const contextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const sendingRef = useRef(false);
  const sentInitialFrameRef = useRef(false);

  useEffect(() => {
    document.cookie = `BASIC_AUTH=${KESTRA_BASIC_AUTH_TOKEN}; Path=/; SameSite=Lax`;
  }, []);

  useEffect(() => {
    const loadAcceptance = () => setAcceptedBy(readAcceptanceStore());
    loadAcceptance();
    setAlertHistory(readAlertHistory());
    window.addEventListener("storage", loadAcceptance);
    return () => window.removeEventListener("storage", loadAcceptance);
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    const loadAcceptanceSnapshot = () => {
      fetch(`/sentinel-acceptances.json?ts=${Date.now()}`, { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : null))
        .then((payload: AcceptanceSnapshot | null) => {
          if (!stopped && payload?.acceptances) setAcceptedBy({ ...readAcceptanceStore(), ...payload.acceptances });
          if (!stopped && payload?.acceptance_counts) setAcceptanceCounts(payload.acceptance_counts);
        })
        .catch(() => {
          if (!stopped) setAcceptedBy(readAcceptanceStore());
        })
        .finally(() => {
          if (!stopped) timer = window.setTimeout(loadAcceptanceSnapshot, 2000);
        });
    };
    loadAcceptanceSnapshot();
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(HELPER_REGISTRATION_KEY, JSON.stringify(helperRegistration));
  }, [helperRegistration]);

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    const loadHelpers = () => {
      fetch(`/sentinel-helpers.json?ts=${Date.now()}`, { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : null))
        .then((payload: HelperSnapshot | null) => {
          if (!stopped) setSnapshotHelpers(Array.isArray(payload?.helpers) ? payload.helpers : []);
        })
        .catch(() => {
          if (!stopped) setSnapshotHelpers([]);
        })
        .finally(() => {
          if (!stopped) timer = window.setTimeout(loadHelpers, 3000);
        });
    };
    loadHelpers();
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!executionFromUrl) return;
    setDispatch((current) => ({
      ...current,
      activeExecutionId: executionFromUrl,
      lastResult: "loading responder alert",
    }));
    setStatus("responder console");
    setDetail(`Watching Kestra execution ${executionFromUrl} for responder ${responderId ?? "unknown"}.`);
  }, [executionFromUrl, responderId]);

  useEffect(() => {
    const executionId = dispatch.activeExecutionId;
    if (!executionId) return;
    let stopped = false;
    let timer: number | undefined;

    const poll = async () => {
      try {
        const execution = await readExecutionDetails(executionId);
        if (stopped) return;
        const helpers = extractHelpers(execution);
        setDispatch((current) => ({
          ...current,
          execution,
          lastResult: execution.state?.current ?? current.lastResult,
          helpers,
        }));
        const responder = helpers.find((helper) => helper.id === responderId || helper.id === trackingResponderId) ?? helpers[0];
        upsertAlertHistory({
          executionId,
          state: execution.state?.current,
          responderId: responder?.id,
          responderName: responder?.name ?? responder?.display_name,
          victimGps: readIncidentGps(execution),
        });
        setAlertHistory(readAlertHistory());
        const currentState = execution.state?.current;
        if (currentState && TERMINAL_STATES.has(currentState)) {
          setStatus(currentState === "SUCCESS" ? "Kestra complete" : "Kestra needs attention");
          setDetail(currentState === "SUCCESS" ? "Execution finished. The panels below are populated from Kestra task outputs." : "Execution reached a terminal non-success state. Inspect the task topology below.");
          return;
        }
      } catch (error) {
        if (!stopped) {
          setStatus("Kestra sync degraded");
          setDetail(readableError(error));
        }
      }
      timer = window.setTimeout(poll, 1000);
    };

    timer = window.setTimeout(poll, 0);
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [dispatch.activeExecutionId, responderId, trackingResponderId]);

  const visibleHelpers = useMemo(() => {
    const live = dispatch.helpers.length > 0 ? dispatch.helpers : snapshotHelpers;
    return live
      .filter((helper) => helper.active !== false && helper.active !== 0)
      .sort((a, b) => helperDistanceValue(a) - helperDistanceValue(b));
  }, [dispatch.helpers, snapshotHelpers]);
  const activeResponder = useMemo(() => {
    if (!responderId) return null;
    return visibleHelpers.find((helper) => helper.id === responderId) ?? null;
  }, [responderId, visibleHelpers]);
  const trackedResponder = useMemo(() => {
    if (!trackingResponderId) return null;
    return visibleHelpers.find((helper) => helper.id === trackingResponderId) ?? null;
  }, [trackingResponderId, visibleHelpers]);
  const kestraGraphUrl = dispatch.activeExecutionId ? kestraExecutionUrl(dispatch.activeExecutionId) : null;
  const victimGps = useMemo(() => readIncidentGps(dispatch.execution) ?? gps, [dispatch.execution, gps]);
  const selectedResponder = useMemo(() => {
    if (!selectedResponderId) return null;
    return visibleHelpers.find((helper) => helper.id === selectedResponderId) ?? null;
  }, [selectedResponderId, visibleHelpers]);
  const primaryResponder = activeResponder ?? trackedResponder ?? selectedResponder ?? visibleHelpers[0] ?? null;
  const route = useMemo(() => routeSummary(victimGps, primaryResponder), [victimGps, primaryResponder]);
  const activeAcceptanceKey = dispatch.activeExecutionId && primaryResponder ? acceptanceKey(dispatch.activeExecutionId, primaryResponder.id) : null;
  const activeExecutionAcceptanceKey = dispatch.activeExecutionId ? executionAcceptanceKey(dispatch.activeExecutionId) : null;
  const activeAcceptance = (activeAcceptanceKey ? acceptedBy[activeAcceptanceKey] : null) ?? (activeExecutionAcceptanceKey ? acceptedBy[activeExecutionAcceptanceKey] : null);
  const audioUrl = findOutput(dispatch.execution, "normalize_payload", "audio_data_url");
  const telegramStatus = findOutput(dispatch.execution, "telegram_dispatch", "telegram_status");
  const telegramReason = findOutput(dispatch.execution, "telegram_dispatch", "reason");

  const refreshAdminSnapshot = useCallback(async () => {
    setAdminStatus("refreshing Kestra admin snapshot");
    try {
      await fetch(KESTRA_ADMIN_SNAPSHOT_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const response = await fetch(`/sentinel-admin.json?ts=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`admin snapshot HTTP ${response.status}`);
      const payload = (await response.json()) as AdminSnapshot;
      setAdminSnapshot(payload);
      setAdminStatus(`updated ${payload.generated_at ? new Date(payload.generated_at).toLocaleTimeString() : new Date().toLocaleTimeString()}`);
    } catch (error) {
      setAdminStatus(readableError(error));
    }
  }, []);

  useEffect(() => {
    if (!isAdminMode) return;
    void refreshAdminSnapshot();
  }, [isAdminMode, refreshAdminSnapshot]);

  useEffect(() => {
    if (!isResponderMode || !responderId || !navigator.geolocation) return;
    let cancelled = false;
    let lastSent = 0;
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        if (cancelled) return;
        const now = Date.now();
        if (now - lastSent < 5000) return;
        lastSent = now;
        const fix: GpsFix = {
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          accuracy_m: position.coords.accuracy,
        };
        setGps(fix);
        fetch(KESTRA_LOCATION_PING_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            responder_id: responderId,
            execution_id: dispatch.activeExecutionId,
            accepted: Boolean(activeAcceptance),
            location: fix,
            client_context: {
              user_agent: navigator.userAgent,
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              local_time: new Date().toISOString(),
            },
          }),
        })
          .then((response) => setLocationPingStatus(response.ok ? `Kestra live location ${new Date().toLocaleTimeString()}` : `Kestra location HTTP ${response.status}`))
          .catch((error) => setLocationPingStatus(readableError(error)));
      },
      (error) => setLocationPingStatus(readableError(error)),
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 12000 }
    );
    return () => {
      cancelled = true;
      navigator.geolocation.clearWatch(watchId);
    };
  }, [activeAcceptance, dispatch.activeExecutionId, isResponderMode, responderId]);

  const acceptAlert = useCallback(async () => {
    if (!dispatch.activeExecutionId || !primaryResponder) return;
    const key = acceptanceKey(dispatch.activeExecutionId, primaryResponder.id);
    const executionKey = executionAcceptanceKey(dispatch.activeExecutionId);
    const acceptedAt = new Date().toISOString();
    localStorage.setItem(key, acceptedAt);
    localStorage.setItem(executionKey, acceptedAt);
    setAcceptedBy(readAcceptanceStore());
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: acceptedAt }));
    window.dispatchEvent(new StorageEvent("storage", { key: executionKey, newValue: acceptedAt }));
    try {
      const response = await fetch(KESTRA_ACCEPT_ALERT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          execution_id: dispatch.activeExecutionId,
          responder_id: primaryResponder.id,
          responder_name: primaryResponder.name ?? primaryResponder.display_name ?? primaryResponder.id,
          accepted_at: acceptedAt,
          location: gps,
        }),
      });
      setDetail(response.ok ? "Responder acceptance saved through Kestra and synced to the victim tracking page." : `Acceptance local, Kestra returned HTTP ${response.status}.`);
    } catch (error) {
      setDetail(`Acceptance local, Kestra sync failed: ${readableError(error)}`);
    }
  }, [dispatch.activeExecutionId, gps, primaryResponder]);

  const saveVictimProfile = useCallback(() => {
    localStorage.setItem(VICTIM_PROFILE_KEY, JSON.stringify(victimProfile));
    setProfileStatus(`saved ${new Date().toLocaleTimeString()}`);
    setProfileExpanded(false);
    setStatus("profile saved");
    setDetail("Emergency profile saved locally and will be attached to future Kestra alerts.");
  }, [victimProfile]);

  const registerHelper = useCallback(async () => {
    setRegistrationStatus("submitting");
    try {
      const position = await readHelperRegistrationPosition(gps, snapshotHelpers);
      const normalizedPhotoUrl = normalizePhotoUrl(helperRegistration.photo_url, helperRegistration.github);
      const normalizedRegistration = { ...helperRegistration, photo_url: normalizedPhotoUrl };
      localStorage.setItem(HELPER_REGISTRATION_KEY, JSON.stringify(normalizedRegistration));
      setHelperRegistration(normalizedRegistration);
      const response = await fetch(KESTRA_REGISTER_HELPER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...normalizedRegistration,
          latitude: position.lat,
          longitude: position.lon,
        }),
      });
      setRegistrationStatus(response.ok ? `registered in Kestra SQLite (${position.source})` : `failed HTTP ${response.status}`);
    } catch (error) {
      setRegistrationStatus(readableError(error));
    }
  }, [gps, helperRegistration, snapshotHelpers]);

  const sendFrame = useCallback(async (samples: Float32Array, fix: GpsFix, sceneImage: string | null) => {
    setStatus("sending to Kestra");
    setDetail("Alert sent. Waiting for an execution id, then the UI will poll Kestra once per second.");
    const wav = encodeWav(samples, 16000);
    const audio_b64 = await blobToBase64(new Blob([wav], { type: "audio/wav" }));
    const response = await fetch(KESTRA_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        audio_b64,
        image_b64: sceneImage ? sceneImage.split(",")[1] : null,
        image_mime: sceneImage ? "image/jpeg" : null,
        preferred_responder_id: selectedResponderId,
        gps: fix,
        victim: { role: "person_in_danger", consent: "emergency_button_pressed", profile: victimProfile },
        client_context: {
          user_agent: navigator.userAgent,
          language: navigator.language,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          screen: `${window.screen.width}x${window.screen.height}`,
          local_time: new Date().toISOString(),
        },
        source: "sentinel-grid-pwa",
      }),
    });
    const result = (await response.json()) as ExecutionResponse;
    const executionId = result.id;
    setDispatch((current) => ({
      count: current.count + 1,
      activeExecutionId: executionId ?? null,
      lastResult: result.state?.current ?? `HTTP ${response.status}`,
      execution: result,
      helpers: extractHelpers(result),
    }));
    setStatus(response.ok ? "Kestra live sync" : "Kestra error");
    setDetail(executionId ? `Polling execution ${executionId} every second through /kestra-api.` : "Kestra did not return an execution id.");
    if (executionId) {
      upsertAlertHistory({ executionId, createdAt: new Date().toISOString(), state: result.state?.current, victimGps: fix });
      setAlertHistory(readAlertHistory());
    }
  }, [selectedResponderId, victimProfile]);

  const arm = useCallback(async () => {
    setArming(true);
    setStatus("requesting sensors");
    setDetail("Waiting for the browser to allow location access.");
    setDispatch({ count: 0, activeExecutionId: null, lastResult: "none", execution: null, helpers: [] });
    sentInitialFrameRef.current = false;

    try {
      const position = await readCurrentPosition();
      const fix: GpsFix = {
        lat: position.coords.latitude,
        lon: position.coords.longitude,
        accuracy_m: position.coords.accuracy,
      };
      setGps(fix);
      setStatus("requesting microphone");
      setDetail("Location locked. Capturing scene image if the camera is available, then recording audio evidence.");
      const sceneImage = (await captureSceneImage()) ?? imagePreview;
      setImagePreview(sceneImage);

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      const context = new AudioContext({ latencyHint: "interactive", sampleRate: 16000 });
      await context.audioWorklet.addModule("/src/worklets/audio-capture.worklet.js");

      const source = context.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(context, "sentinel-audio-capture", { numberOfInputs: 1, numberOfOutputs: 0 });
      worklet.port.onmessage = async (event: MessageEvent<Float32Array>) => {
        if (sendingRef.current || sentInitialFrameRef.current) return;
        sendingRef.current = true;
        sentInitialFrameRef.current = true;
        try {
          await sendFrame(event.data, fix, sceneImage);
        } finally {
          sendingRef.current = false;
        }
      };

      source.connect(worklet);
      contextRef.current = context;
      streamRef.current = stream;
      workletRef.current = worklet;
      setArmed(true);
      setStatus("armed");
      setDetail("Armed. Capturing an 8-second emergency audio clip before creating the Kestra execution.");
    } catch (error) {
      setArmed(false);
      setStatus("sensor error");
      setDetail(readableError(error));
    } finally {
      setArming(false);
    }
  }, [imagePreview, sendFrame]);

  const disarm = useCallback(async () => {
    workletRef.current?.disconnect();
    workletRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    await contextRef.current?.close();
    contextRef.current = null;
    sentInitialFrameRef.current = false;
    setArmed(false);
    setStatus("idle");
    setDetail("Sensors stopped. Existing execution details remain visible below.");
  }, []);

  return (
    <main className="shell">
      <section className="command">
        <div>
          <span className="eyebrow">{isResponderMode ? "Responder Dispatch" : "Sentinel Grid Tactical Command"}</span>
          <h1>{isResponderMode ? "Rescue Assignment" : isHelperOnboarding ? "Helper Onboarding" : isAdminMode ? "Admin Ops" : isVictimTrackingMode ? "Live Rescue Tracking" : "Emergency Tap"}</h1>
          <p>{isResponderMode ? "Accept the alert, see the person-in-danger location, inspect evidence, and navigate." : isHelperOnboarding ? "Register a responder profile through Kestra, then use the responder console link during alerts." : isAdminMode ? "Inspect responder integrity, acceptance counts, incident areas, and operational snapshots from Kestra and SQLite." : isVictimTrackingMode ? "Watch responder acceptance, evidence, route, and Kestra execution state for this alert." : "Request help, watch responder acceptance, and track arrival like a live delivery handoff."}</p>
        </div>

        <div className="control">
          <ShieldAlert size={42} aria-hidden />
          <span className="status">{status}</span>
          <span className="detail">{detail}</span>
          {showEmergencySetup ? (
            <button type="button" onClick={armed ? disarm : arm} aria-pressed={armed} disabled={arming}>
              <Radio size={20} aria-hidden />
              {armed ? "Stop Alert" : arming ? "Arming" : "Send Alert"}
            </button>
          ) : null}
        </div>
      </section>

      <nav className="top-nav" aria-label="Sentinel sections">
        <a href="#incident">Incident</a>
        <a href="#route">Live route</a>
        <a href="#evidence">Evidence</a>
        {showEmergencySetup ? <a href="#profile">Profile</a> : null}
        {!isResponderMode ? <a href="/?onboard=helper">Become helper</a> : null}
        {!isResponderMode ? <a href="/?admin=ops">Admin ops</a> : null}
        {!isResponderMode ? <a href="#helpers">Helpers</a> : null}
        <a href="#history">Past alerts</a>
        <a href="#kestra">Kestra</a>
      </nav>

      <section className="grid">
        {isAdminMode ? <AdminOpsPanel snapshot={adminSnapshot} status={adminStatus} onRefresh={refreshAdminSnapshot} /> : null}

        {!isResponderMode && activeAcceptance ? (
          <section className="panel acceptance-banner">
            <CheckCircle2 size={20} aria-hidden />
            <strong>{primaryResponder ? primaryResponder.name ?? primaryResponder.display_name ?? "Responder" : "Responder"} accepted your alert.</strong>
            <span>{new Date(activeAcceptance).toLocaleTimeString()}</span>
          </section>
        ) : null}

        <section id="incident" className="panel telemetry">
          <div className="panel-title">
            <MapPin size={18} aria-hidden />
            <h2>Live Incident</h2>
          </div>
          <span>Latitude {victimGps?.lat.toFixed(6) ?? "pending"}</span>
          <span>Longitude {victimGps?.lon.toFixed(6) ?? "pending"}</span>
          <span>Accuracy {victimGps?.accuracy_m?.toFixed(0) ?? "pending"} m</span>
          <span>Responder {primaryResponder ? primaryResponder.name ?? primaryResponder.display_name ?? primaryResponder.id : "pending"}</span>
          {!isResponderMode ? <span>Selection {selectedResponderId ? "manual responder selected" : "auto nearest responder"}</span> : null}
          <span>Acceptance {activeAcceptance ? "accepted" : "waiting"}</span>
          <span>ETA {route?.etaMinutes ?? "pending"} min</span>
          <span>Distance {route ? `${route.distanceKm.toFixed(2)} km` : "pending"}</span>
          <span>Kestra executions {dispatch.count}</span>
          <span>Active execution {dispatch.activeExecutionId ?? "pending"}</span>
          <span>Last result {dispatch.lastResult}</span>
          {kestraGraphUrl ? (
            <a className="inline-link" href={kestraGraphUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={14} aria-hidden />
              Open real Kestra topology
            </a>
          ) : null}
        </section>

        <section className="panel telemetry">
          <div className="panel-title">
            <Database size={18} aria-hidden />
            <h2>Kestra Outputs</h2>
          </div>
          <span>Audio AI {findOutput(dispatch.execution, "verify_distress_edge_tpu", "audio_ai") ?? "pending"}</span>
          <span>Hardware Acceleration {findOutput(dispatch.execution, "verify_distress_edge_tpu", "hardware_status") ?? "pending"}</span>
          <span>Cybercrime Check {findOutput(dispatch.execution, "verify_responder_security", "cybercrime_check") ?? "pending"}</span>
          <span>Blacklisted {findOutput(dispatch.execution, "verify_responder_security", "blacklisted_count") ?? "pending"}</span>
          <span>Report {findOutput(dispatch.execution, "anonymous_report_automation", "report_status") ?? "pending"}</span>
          <span>Analytics Area {findOutput(dispatch.execution, "persist_incident_analytics", "area_key") ?? "pending"}</span>
          <span>Telegram {telegramStatus ? `${telegramStatus}${telegramReason ? `: ${telegramReason}` : ""}` : "pending"}</span>
          <span>Trusted Contacts {findOutput(dispatch.execution, "dispatch_trusted_contacts", "trusted_email_status") ?? "pending"}</span>
        </section>

        <section id="route" className="panel route-panel">
          <div className="panel-title">
            <Route size={18} aria-hidden />
            <h2>Rescue Route</h2>
          </div>
          <div className="route-map">
            <div className="route-point victim">
              <MapPin size={18} aria-hidden />
              <strong>Person in danger</strong>
              <span>{victimGps ? `${victimGps.lat.toFixed(6)}, ${victimGps.lon.toFixed(6)}` : "location pending"}</span>
            </div>
            <div className="route-line" />
            <div className="route-point responder">
              <Navigation size={18} aria-hidden />
              <strong>{primaryResponder ? primaryResponder.name ?? primaryResponder.display_name ?? "Responder" : "Responder"}</strong>
              <span>{helperLocation(primaryResponder) ?? "location pending"}</span>
            </div>
          </div>
          <div className="route-stats">
          <span>{route ? `${route.distanceKm.toFixed(2)} km` : "distance pending"}</span>
          <span>{route ? `${route.etaMinutes} min ETA` : "ETA pending"}</span>
          <span>{primaryResponder?.location_updated_at ? `responder updated ${new Date(primaryResponder.location_updated_at).toLocaleTimeString()}` : "responder location from Kestra/SQLite"}</span>
          <span className={activeAcceptance ? "accepted" : "waiting"}>{activeAcceptance ? "accepted alert" : "waiting for accept"}</span>
          </div>
          {incidentMapUrl(dispatch.execution) ? (
            <a className="inline-link" href={incidentMapUrl(dispatch.execution)!} target="_blank" rel="noreferrer">
              <MapPin size={14} aria-hidden />
              {isResponderMode ? "Navigate to victim" : "Open incident map"}
            </a>
          ) : null}
        </section>

        <section id="evidence" className="panel evidence-panel">
          <div className="panel-title">
            <Volume2 size={18} aria-hidden />
            <h2>Audio Evidence</h2>
          </div>
          <span>Environment {findOutput(dispatch.execution, "verify_distress_edge_tpu", "environment_sound") ?? "pending"}</span>
          <span>Transcript {findOutput(dispatch.execution, "verify_distress_edge_tpu", "transcript") ?? "pending"}</span>
          <span>Duration {findOutput(dispatch.execution, "normalize_payload", "audio_seconds") ?? "pending"} sec</span>
          {!isResponderMode ? (
            <label className="file-picker">
              <span>Scene photo for responders</span>
              <input type="file" accept="image/*" capture="environment" onChange={(event) => void readImageFile(event.currentTarget.files?.[0] ?? null).then(setImagePreview)} />
            </label>
          ) : null}
          {imagePreview ? <img className="scene-preview" src={imagePreview} alt="Latest emergency scene" /> : null}
          {typeof findOutput(dispatch.execution, "normalize_payload", "image_data_url") === "string" ? (
            <img className="scene-preview" src={findOutput(dispatch.execution, "normalize_payload", "image_data_url") as string} alt="Latest emergency scene" />
          ) : null}
          {typeof audioUrl === "string" ? (
            <>
              <audio controls src={audioUrl} />
              <a className="inline-link" href={audioUrl} download={`${dispatch.activeExecutionId ?? "sentinel"}-evidence.wav`}>
                <FileAudio size={14} aria-hidden />
                Download raw audio
              </a>
            </>
          ) : null}
        </section>

        {showEmergencySetup ? (
          <>
          <section id="profile" className="panel profile-panel">
            <div className="panel-title">
              <UserRound size={18} aria-hidden />
              <h2>{profileExpanded ? "Emergency Profile" : "User Account"}</h2>
            </div>
            {profileExpanded ? (
              <>
                <input value={victimProfile.name} onChange={(event) => setVictimProfile({ ...victimProfile, name: event.target.value })} placeholder="Your name (optional)" />
                <input value={victimProfile.phone} onChange={(event) => setVictimProfile({ ...victimProfile, phone: event.target.value })} placeholder="Your phone (optional)" />
                <input value={victimProfile.emergencyContact} onChange={(event) => setVictimProfile({ ...victimProfile, emergencyContact: event.target.value })} placeholder="Emergency contact name / note" />
                <label className="field-stack">
                  <span>Trusted friend emails</span>
                  <textarea value={victimProfile.trustedContacts} onChange={(event) => setVictimProfile({ ...victimProfile, trustedContacts: event.target.value })} placeholder="friend@example.com, another@example.com" />
                </label>
                <textarea value={victimProfile.notes} onChange={(event) => setVictimProfile({ ...victimProfile, notes: event.target.value })} placeholder="Medical notes / safety context" />
                <button type="button" onClick={saveVictimProfile}>
                  <CheckCircle2 size={18} aria-hidden />
                  Save Profile
                </button>
                <span className="form-status">{profileStatus}</span>
              </>
            ) : (
              <div className="account-summary">
                <span>Name {victimProfile.name || "not set"}</span>
                <span>Phone {victimProfile.phone || "not set"}</span>
                <span>Trusted contacts {trustedEmailCount(victimProfile.trustedContacts)}</span>
                <span>Emergency note {victimProfile.emergencyContact || "not set"}</span>
                <button type="button" className="secondary" onClick={() => setProfileExpanded(true)}>
                  Edit Profile
                </button>
              </div>
            )}
          </section>

          </>
        ) : null}

        {!isResponderMode && isHelperOnboarding ? (
          <section id="profile" className="panel registration-panel onboarding-panel">
            <div className="panel-title">
              <UserPlus size={18} aria-hidden />
              <h2>Register As Helper</h2>
            </div>
            <input value={helperRegistration.display_name} onChange={(event) => setHelperRegistration({ ...helperRegistration, display_name: event.target.value })} placeholder="Helper name" />
            <input value={helperRegistration.phone} onChange={(event) => setHelperRegistration({ ...helperRegistration, phone: event.target.value })} placeholder="Phone / Telegram fallback" />
            <input value={helperRegistration.email} onChange={(event) => setHelperRegistration({ ...helperRegistration, email: event.target.value })} placeholder="Email for alerts" />
            <input value={helperRegistration.github} onChange={(event) => setHelperRegistration({ ...helperRegistration, github: event.target.value })} placeholder="GitHub handle (optional)" />
            <input value={helperRegistration.photo_url} onChange={(event) => setHelperRegistration({ ...helperRegistration, photo_url: event.target.value })} placeholder="Photo URL (optional)" />
            <div className="helper-preview">
              <img src={normalizePhotoUrl(helperRegistration.photo_url, helperRegistration.github)} alt={helperRegistration.display_name || "Helper"} />
              <span>{normalizePhotoUrl(helperRegistration.photo_url, helperRegistration.github).includes("github.com") ? "GitHub avatar will be used" : "Photo preview"}</span>
            </div>
            <button type="button" onClick={registerHelper}>
              <UserPlus size={18} aria-hidden />
              Register Helper
            </button>
            <span className="form-status">{registrationStatus}</span>
          </section>
        ) : null}

        {!isResponderMode ? (
          <section id="helpers" className="panel matches">
            <div className="panel-title">
              <UserRound size={18} aria-hidden />
              <h2>Verified Nearby Responders</h2>
            </div>
            {visibleHelpers.length === 0 ? (
              <p className="empty">No helper rows available yet. Run the Kestra flow or refresh the SQLite UI snapshot.</p>
            ) : (
              visibleHelpers.map((helper) => (
                <HelperCard
                  key={helper.id}
                  helper={helper}
                  executionId={dispatch.activeExecutionId}
                  victimGps={victimGps}
                  acceptedAt={
                    dispatch.activeExecutionId
                      ? acceptedBy[acceptanceKey(dispatch.activeExecutionId, helper.id)] ?? acceptedBy[executionAcceptanceKey(dispatch.activeExecutionId)]
                      : null
                  }
                  acceptanceMetric={acceptanceCounts[helper.id]}
                  selected={primaryResponder?.id === helper.id}
                  onSelect={() => setSelectedResponderId(helper.id)}
                />
              ))
            )}
          </section>
        ) : null}

        <section id="history" className="panel history-panel">
          <div className="panel-title">
            <History size={18} aria-hidden />
            <h2>Past Alerts</h2>
          </div>
          {alertHistory.length === 0 ? (
            <p className="empty">No local alert history yet.</p>
          ) : (
            alertHistory.map((item) => (
              <a key={item.executionId} className="history-row" href={`/?track=${encodeURIComponent(item.responderId ?? "helper-vicky-kumar")}&execution=${encodeURIComponent(item.executionId)}`}>
                <strong>{item.responderName ?? item.responderId ?? "Responder pending"}</strong>
                <span>{new Date(item.createdAt).toLocaleString()}</span>
                <span>{item.state ?? "created"}</span>
              </a>
            ))
          )}
        </section>

        {responderId ? (
          <section className="panel responder-console">
            <div className="panel-title">
              <ShieldAlert size={18} aria-hidden />
              <h2>Responder Console</h2>
            </div>
            <span>Responder {activeResponder?.name ?? activeResponder?.display_name ?? responderId}</span>
            <span>Verification {activeResponder?.verification_status ?? "pending"}</span>
            <span>Cybercrime {activeResponder?.cybercrime_status ?? "pending"}</span>
            <span>Execution {dispatch.activeExecutionId ?? "pending"}</span>
            <span>Live location {locationPingStatus}</span>
            <span>Victim GPS {formatIncidentGps(dispatch.execution)}</span>
            <span>Route {route ? `${route.distanceKm.toFixed(2)} km / ${route.etaMinutes} min ETA` : "pending"}</span>
            <span>Acceptance {activeAcceptance ? `accepted ${new Date(activeAcceptance).toLocaleTimeString()}` : "waiting"}</span>
            <button type="button" onClick={acceptAlert} disabled={!dispatch.activeExecutionId || !primaryResponder}>
              <CheckCircle2 size={18} aria-hidden />
              Accept Alert
            </button>
            {incidentMapUrl(dispatch.execution) ? (
              <a className="inline-link" href={incidentMapUrl(dispatch.execution)!} target="_blank" rel="noreferrer">
                <MapPin size={14} aria-hidden />
                Open victim location
              </a>
            ) : null}
            {kestraGraphUrl ? (
              <a className="inline-link" href={kestraGraphUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={14} aria-hidden />
                Open Kestra graph for this alert
              </a>
            ) : null}
          </section>
        ) : null}

        <section id="kestra" className="panel topology">
          <div className="panel-title">
            <Activity size={18} aria-hidden />
            <h2>Real Kestra Topology</h2>
          </div>
          {kestraGraphUrl ? (
            <iframe className="kestra-frame" title="Kestra execution topology" src={kestraGraphUrl} />
          ) : null}
          <ol className="task-graph">
            {(dispatch.execution?.taskRunList ?? []).length === 0 ? (
              <li className="pending">
                <strong>waiting_for_execution</strong>
                <small>No taskRuns returned from Kestra yet.</small>
              </li>
            ) : (
              dispatch.execution?.taskRunList?.map((task) => (
                <li key={task.id ?? task.taskId} className={taskClass(visualTaskState(task))}>
                  <strong>{task.taskId ?? "unknown_task"}</strong>
                  <small>{visualTaskState(task)}</small>
                  <dl className="node-outputs">
                    {taskOutputRows(task).map(([key, value]) => (
                      <div key={key}>
                        <dt>{key}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                </li>
              ))
            )}
          </ol>
        </section>
      </section>
    </main>
  );
}

function AdminOpsPanel({ snapshot, status, onRefresh }: { snapshot: AdminSnapshot | null; status: string; onRefresh: () => void }): React.ReactElement {
  const summary = snapshot?.summary ?? {};
  const helpers = snapshot?.helpers ?? [];
  const acceptances = snapshot?.acceptances ?? [];
  const topAreas = snapshot?.top_areas ?? [];
  return (
    <section className="panel admin-panel">
      <div className="panel-title">
        <Database size={18} aria-hidden />
        <h2>Admin Ops Snapshot</h2>
      </div>
      <div className="admin-actions">
        <button type="button" onClick={onRefresh}>
          <Activity size={18} aria-hidden />
          Refresh Kestra Snapshot
        </button>
        <span className="form-status">{status}</span>
      </div>
      <div className="admin-metrics">
        <span>Helpers {summary.helpers_total ?? 0}</span>
        <span>Active {summary.helpers_active ?? 0}</span>
        <span>Verified {summary.helpers_verified ?? 0}</span>
        <span>Flagged {summary.helpers_flagged ?? 0}</span>
        <span>Acceptances {summary.acceptances_total ?? 0}</span>
        <span>Incidents {summary.incidents_total ?? 0}</span>
      </div>
      <div className="admin-grid">
        <section>
          <h3>Responder Performance</h3>
          {helpers.length === 0 ? <p className="empty">No responders in admin snapshot.</p> : null}
          {helpers.slice(0, 12).map((helper) => (
            <div key={helper.id} className="admin-row">
              <strong>{helper.name ?? helper.display_name ?? helper.id}</strong>
              <span>{helper.verification_status ?? "verification pending"} / {helper.cybercrime_status ?? "cybercrime pending"}</span>
              <span>accepted {helper.accepted_count ?? 0}</span>
              <span>{helper.last_accepted_at ? `last ${new Date(helper.last_accepted_at).toLocaleString()}` : "no accepted alerts yet"}</span>
            </div>
          ))}
        </section>
        <section>
          <h3>Recent Acceptances</h3>
          {acceptances.length === 0 ? <p className="empty">No acceptances recorded yet.</p> : null}
          {acceptances.slice(0, 10).map((item, index) => (
            <div key={`${String(item.execution_id ?? index)}-${String(item.responder_id ?? index)}`} className="admin-row">
              <strong>{String(item.responder_name ?? item.responder_id ?? "responder")}</strong>
              <span>{String(item.execution_id ?? "execution pending")}</span>
              <span>{item.accepted_at ? new Date(String(item.accepted_at)).toLocaleString() : "accepted time pending"}</span>
            </div>
          ))}
        </section>
        <section>
          <h3>Hot Areas</h3>
          {topAreas.length === 0 ? <p className="empty">No incident analytics yet.</p> : null}
          {topAreas.slice(0, 10).map((item, index) => (
            <div key={`${String(item.area_key ?? index)}`} className="admin-row">
              <strong>{String(item.area_key ?? "area pending")}</strong>
              <span>incidents {String(item.incident_count ?? 0)}</span>
              <span>avg confidence {String(item.avg_confidence ?? "pending")}</span>
            </div>
          ))}
        </section>
      </div>
    </section>
  );
}

function HelperCard({
  helper,
  executionId,
  victimGps,
  acceptedAt,
  acceptanceMetric,
  selected,
  onSelect,
}: {
  helper: HelperMatch;
  executionId: string | null;
  victimGps: GpsFix | null;
  acceptedAt: string | null;
  acceptanceMetric?: AcceptanceMetric;
  selected: boolean;
  onSelect: () => void;
}): React.ReactElement {
  const name = helper.name ?? helper.display_name ?? helper.id;
  const verification = normalizeBadge(helper.verification_status, "unverified");
  const cybercrime = normalizeBadge(helper.cybercrime_status, "unchecked");
  const trackingUrl = executionId ? `/?track=${encodeURIComponent(helper.id)}&execution=${encodeURIComponent(executionId)}` : null;
  const route = routeSummary(victimGps, helper);
  const acceptedCount = Number(acceptanceMetric?.accepted_count ?? helper.accepted_count ?? 0);
  const lastAcceptedAt = acceptanceMetric?.last_accepted_at ?? helper.last_accepted_at;
  return (
    <article>
      <img src={normalizePhotoUrl(helper.photo_url, helper.github)} alt={name} />
      <div>
        <strong>{name}</strong>
        <span>{helperDistance(helper)}</span>
        <span>{helperLocation(helper) ? `Live location ${helperLocation(helper)}` : "live location pending"}</span>
        <span>{helper.location_updated_at ? `Updated ${new Date(helper.location_updated_at).toLocaleTimeString()}` : "SQLite/Kestra last known location"}</span>
        <span>{helper.phone ?? "phone pending"}</span>
        <span>{helper.email ?? "email pending"}</span>
        <span>{helper.verification_source ? `Verified by ${helper.verification_source}` : "verification source pending"}</span>
        <span>{helper.cybercrime_checked_at ? `Cybercrime checked ${new Date(helper.cybercrime_checked_at).toLocaleString()}` : "cybercrime check pending"}</span>
        <span>Accepted alerts {acceptedCount}</span>
        <span>{lastAcceptedAt ? `Last accepted ${new Date(lastAcceptedAt).toLocaleString()}` : "last acceptance pending"}</span>
        {executionId ? (
          <div className="inline-route">
            <span>{route ? `${route.distanceKm.toFixed(2)} km / ${route.etaMinutes} min ETA` : "route pending"}</span>
            <span className={acceptedAt ? "accepted" : "waiting"}>{acceptedAt ? `accepted ${new Date(acceptedAt).toLocaleTimeString()}` : "waiting for accept"}</span>
          </div>
        ) : null}
        <div className="badges">
          <span className={`badge ${verification.className}`}>{verification.label}</span>
          <span className={`badge ${cybercrime.className}`}>{cybercrime.label}</span>
        </div>
        {helper.blacklist_reason ? <span className="danger-text">{helper.blacklist_reason}</span> : null}
        <div className="helper-actions">
          <button type="button" className={selected ? "secondary selected" : "secondary"} onClick={onSelect}>
            <CheckCircle2 size={14} aria-hidden />
            {selected ? "Selected for dispatch" : "Contact this responder"}
          </button>
          {helperMapUrl(helper) ? (
            <a className="inline-link" href={helperMapUrl(helper)!} target="_blank" rel="noreferrer">
              <MapPin size={14} aria-hidden />
              Responder map
            </a>
          ) : null}
        </div>
        {trackingUrl ? (
          <a className="inline-link" href={trackingUrl}>
            <ShieldAlert size={14} aria-hidden />
            Open full live tracking
          </a>
        ) : null}
      </div>
    </article>
  );
}

function extractHelpers(result: ExecutionResponse | null): HelperMatch[] {
  if (!result?.taskRunList) return [];
  const security = result.taskRunList.find((item) => item.taskId === "verify_responder_security");
  const checked = readArrayOutput(security?.outputs, "nearest_helpers") ?? readArrayOutput(security?.outputs, "checked_helpers");
  if (checked) return normalizeHelpers(checked);
  const radius = result.taskRunList.find((item) => item.taskId === "nearest_helpers_by_radius");
  return normalizeHelpers(readArrayOutput(radius?.outputs, "rows") ?? []);
}

function normalizeHelpers(rows: HelperMatch[]): HelperMatch[] {
  return rows.map((row) => ({
    ...row,
    distance_km: typeof row.distance_km === "number" ? row.distance_km : typeof row.distance_km2 === "number" ? Math.sqrt(row.distance_km2) : null,
  }));
}

function readArrayOutput(outputs: TaskOutputs | undefined, key: "rows" | "nearest_helpers" | "checked_helpers"): HelperMatch[] | null {
  const value = outputs?.[key] ?? outputs?.vars?.[key];
  return Array.isArray(value) ? (value as HelperMatch[]) : null;
}

function findOutput(result: ExecutionResponse | null, taskId: string, key: string): string | number | null {
  const task = result?.taskRunList?.find((item) => item.taskId === taskId);
  const value = task?.outputs?.[key] ?? task?.outputs?.vars?.[key];
  if (typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  return null;
}

function kestraExecutionUrl(executionId: string): string {
  return `${KESTRA_UI_BASE}/ui/executions/sentinel.grid/sentinel_core/${executionId}`;
}

function formatIncidentGps(result: ExecutionResponse | null): string {
  const payload = readPayload(result);
  const gps = payload?.gps as { lat?: number; lon?: number } | undefined;
  if (typeof gps?.lat !== "number" || typeof gps?.lon !== "number") return "pending";
  return `${gps.lat.toFixed(6)}, ${gps.lon.toFixed(6)}`;
}

function incidentMapUrl(result: ExecutionResponse | null): string | null {
  const gps = readIncidentGps(result);
  if (!gps) return null;
  return `https://maps.google.com/?q=${gps.lat},${gps.lon}`;
}

function readIncidentGps(result: ExecutionResponse | null): GpsFix | null {
  const payload = readPayload(result);
  const gps = payload?.gps as { lat?: number; lon?: number; accuracy_m?: number | null } | undefined;
  if (typeof gps?.lat !== "number" || typeof gps?.lon !== "number") return null;
  return { lat: gps.lat, lon: gps.lon, accuracy_m: typeof gps.accuracy_m === "number" ? gps.accuracy_m : null };
}

function readPayload(result: ExecutionResponse | null): Record<string, unknown> | null {
  const raw = findOutput(result, "normalize_payload", "payload_json");
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed;
  } catch {
    return null;
  }
}

async function readExecutionDetails(executionId: string): Promise<ExecutionResponse> {
  const response = await fetch(`${KESTRA_API_BASE}/executions/${executionId}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Kestra execution read failed with HTTP ${response.status}`);
  return (await response.json()) as ExecutionResponse;
}

async function captureSceneImage(): Promise<string | null> {
  if (!navigator.mediaDevices?.getUserMedia) return null;
  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 960 }, height: { ideal: 540 } }, audio: false });
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    await new Promise((resolve) => window.setTimeout(resolve, 250));
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 960;
    canvas.height = video.videoHeight || 540;
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.72);
  } catch {
    return null;
  } finally {
    stream?.getTracks().forEach((track) => track.stop());
  }
}

function readImageFile(file: File | null): Promise<string | null> {
  if (!file) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => reject(reader.error ?? new Error("Could not read scene image."));
    reader.readAsDataURL(file);
  });
}

function taskState(task: TaskRun): string {
  return task.state?.current ?? task.attempts?.at(-1)?.state?.current ?? "UNKNOWN";
}

function visualTaskState(task: TaskRun): string {
  const delivery = task.taskId === "telegram_dispatch" ? readStringOutput(task.outputs, "telegram_status") : task.taskId === "email_dispatch" ? readStringOutput(task.outputs, "email_status") : null;
  if (delivery === "failed" || delivery === "skipped") return delivery.toUpperCase();
  return taskState(task);
}

function readStringOutput(outputs: TaskOutputs | undefined, key: string): string | null {
  const value = outputs?.[key] ?? outputs?.vars?.[key];
  return typeof value === "string" ? value : null;
}

function taskOutputRows(task: TaskRun): Array<[string, string]> {
  const vars = task.outputs?.vars ?? task.outputs;
  if (!vars) return [["outputs", "pending"]];
  return Object.entries(vars)
    .filter(([key]) => !["vars", "payload_json", "audio_data_url", "image_data_url", "distress_json"].includes(key))
    .slice(0, 8)
    .map(([key, value]) => [key, summarizeOutputValue(value)]);
}

function summarizeOutputValue(value: unknown): string {
  if (Array.isArray(value)) {
    const names = value
      .slice(0, 3)
      .map((item) => (typeof item === "object" && item !== null ? String((item as HelperMatch).name ?? (item as HelperMatch).display_name ?? (item as HelperMatch).id ?? "row") : String(item)))
      .join(", ");
    return `${value.length} ${value.length === 1 ? "row" : "rows"}${names ? `: ${names}` : ""}`;
  }
  if (typeof value === "object" && value !== null) return JSON.stringify(value).slice(0, 180);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value === null || value === undefined || value === "") return "empty";
  return String(value).slice(0, 180);
}

function helperDistance(helper: HelperMatch): string {
  const distance = helperDistanceValue(helper);
  if (!Number.isFinite(distance)) return "inside alert radius";
  return `${distance.toFixed(2)} km away`;
}

function helperDistanceValue(helper: HelperMatch): number {
  const distance = helper.distance_km ?? (typeof helper.distance_km2 === "number" ? Math.sqrt(helper.distance_km2) : null);
  return distance === null ? Number.POSITIVE_INFINITY : distance;
}

function helperMapUrl(helper: HelperMatch | null): string | null {
  if (typeof helper?.latitude !== "number" || typeof helper.longitude !== "number") return null;
  return `https://maps.google.com/?q=${helper.latitude},${helper.longitude}`;
}

function helperLocation(helper: HelperMatch | null): string | null {
  if (typeof helper?.latitude !== "number" || typeof helper.longitude !== "number") return null;
  return `${helper.latitude.toFixed(6)}, ${helper.longitude.toFixed(6)}`;
}

function routeSummary(victim: GpsFix | null, helper: HelperMatch | null): { distanceKm: number; etaMinutes: number } | null {
  if (!victim || typeof helper?.latitude !== "number" || typeof helper.longitude !== "number") return null;
  const distanceKm = haversineKm(victim.lat, victim.lon, helper.latitude, helper.longitude);
  return { distanceKm, etaMinutes: Math.max(1, Math.ceil((distanceKm / 24) * 60)) };
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

function acceptanceKey(executionId: string, responderId: string): string {
  return `${ACCEPTANCE_PREFIX}${executionId}:${responderId}`;
}

function executionAcceptanceKey(executionId: string): string {
  return `${ACCEPTANCE_PREFIX}${executionId}:accepted`;
}

function readAcceptanceStore(): Record<string, string> {
  const values: Record<string, string> = {};
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith(ACCEPTANCE_PREFIX)) continue;
    values[key] = localStorage.getItem(key) ?? "";
  }
  return values;
}

function readAlertHistory(): AlertHistoryItem[] {
  return readJson<AlertHistoryItem[]>(ALERT_HISTORY_KEY, []);
}

function upsertAlertHistory(item: Partial<AlertHistoryItem> & { executionId: string }): void {
  const current = readAlertHistory().filter((entry) => entry.executionId !== item.executionId);
  const merged: AlertHistoryItem = {
    executionId: item.executionId,
    createdAt: item.createdAt ?? current.find((entry) => entry.executionId === item.executionId)?.createdAt ?? new Date().toISOString(),
    responderId: item.responderId,
    responderName: item.responderName,
    state: item.state,
    victimGps: item.victimGps,
  };
  localStorage.setItem(ALERT_HISTORY_KEY, JSON.stringify([merged, ...current].slice(0, 30)));
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function normalizeVictimProfile(profile: Partial<VictimProfile>): VictimProfile {
  return {
    name: profile.name ?? "",
    phone: profile.phone ?? "",
    emergencyContact: profile.emergencyContact ?? "",
    trustedContacts: profile.trustedContacts ?? "",
    notes: profile.notes ?? "",
  };
}

function trustedEmailCount(value: string): number {
  const emails = value
    .split(/[\n,; ]+/)
    .map((item) => item.trim())
    .filter((item) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(item));
  return new Set(emails.map((email) => email.toLowerCase())).size;
}

function normalizePhotoUrl(photoUrl?: string | null, github?: string | null): string {
  const direct = (photoUrl || "").trim();
  const handleFromDirect = githubHandle(direct);
  if (handleFromDirect && !/\.(png|jpe?g|webp|gif)(\?.*)?$/i.test(direct)) return `https://github.com/${handleFromDirect}.png`;
  if (direct) return direct;
  const handle = githubHandle(github || "");
  if (handle) return `https://github.com/${handle}.png`;
  return "https://github.com/identicons/sentinel-grid.png";
}

function githubHandle(value: string): string | null {
  const trimmed = value.trim().replace(/^@/, "");
  if (!trimmed) return null;
  const match = trimmed.match(/github\.com\/([^/?#]+)/i);
  const handle = match?.[1] ?? trimmed;
  if (!/^[a-z0-9-]{1,39}$/i.test(handle)) return null;
  return handle;
}

function normalizeBadge(value: string | null | undefined, fallback: string): { label: string; className: string } {
  const normalized = (value || fallback).toLowerCase();
  if (normalized === "verified" || normalized === "clear") return { label: normalized === "clear" ? "Cybercrime Clear" : "Verified", className: "good" };
  if (normalized === "flagged") return { label: "Cybercrime Flagged", className: "bad" };
  if (normalized === "operator_required" || normalized === "unknown") return { label: normalized.replace("_", " "), className: "warn" };
  return { label: normalized.charAt(0).toUpperCase() + normalized.slice(1), className: "neutral" };
}

function taskClass(state: string | undefined): string {
  if (state === "SUCCESS") return "complete";
  if (state === "FAILED" || state === "WARNING" || state === "FAILED" || state === "SKIPPED") return "failed";
  if (state === "RUNNING" || state === "CREATED" || state === "RESTARTED") return "active";
  return "pending";
}

function readCurrentPosition(): Promise<GeolocationPosition> {
  if (!navigator.geolocation) return Promise.reject(new Error("Geolocation is not available in this browser."));
  return new Promise<GeolocationPosition>((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 })
  );
}

async function readHelperRegistrationPosition(gps: GpsFix | null, helpers: HelperMatch[]): Promise<HelperRegistrationPosition> {
  try {
    const position = await readCurrentPosition();
    return {
      lat: position.coords.latitude,
      lon: position.coords.longitude,
      accuracy_m: position.coords.accuracy,
      source: "browser GPS",
    };
  } catch (error) {
    const reusable = helpers.find((helper) => typeof helper.latitude === "number" && typeof helper.longitude === "number");
    if (reusable && typeof reusable.latitude === "number" && typeof reusable.longitude === "number") {
      return {
        lat: reusable.latitude,
        lon: reusable.longitude,
        accuracy_m: null,
        source: "last known Kestra location",
      };
    }
    if (gps) {
      return { lat: gps.lat, lon: gps.lon, accuracy_m: gps.accuracy_m, source: "current incident GPS" };
    }
    throw error;
  }
}

function readableError(error: unknown): string {
  if (isGeolocationError(error)) {
    if (error.code === 1) return "Location permission was denied. Allow location for localhost, or open this page after an alert/location ping so Kestra has a last known helper location.";
    if (error.code === 2) return "Location is unavailable. Check OS location services and browser site permissions.";
    if (error.code === 3) return "Location timed out. Move near a window or retry with location services enabled.";
  }
  if (error instanceof DOMException && error.name === "NotAllowedError") return "Microphone permission was denied. Allow microphone for localhost and press Send Alert again.";
  if (error instanceof DOMException && error.name === "NotFoundError") return "No microphone was found by the browser.";
  if (error instanceof Error) return error.message;
  return "Unknown failure.";
}

function isGeolocationError(error: unknown): error is GeolocationPositionError {
  return typeof error === "object" && error !== null && "code" in error && "message" in error;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  let binary = "";
  new Uint8Array(buffer).forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary);
}

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(view, 8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => view.setInt16(44 + index * 2, Math.max(-1, Math.min(1, sample)) * 0x7fff, true));
  return buffer;
}

function writeAscii(view: DataView, offset: number, text: string): void {
  [...text].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
}

const container = document.getElementById("root")!;
const rootStore = globalThis as typeof globalThis & { __sentinelGridRoot?: Root };
rootStore.__sentinelGridRoot ??= createRoot(container);
rootStore.__sentinelGridRoot.render(<App />);
