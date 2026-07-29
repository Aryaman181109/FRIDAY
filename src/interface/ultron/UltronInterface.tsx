import { useCallback, useEffect, useRef, useState } from "react";
import {
  createOrbScene,
  type OrbSceneApi,
  type QualityProfile,
} from "./orbScene";
import {
  HandTracker,
  type TrackerStatus,
  type DebugInfo,
  type TrackingPhase,
  type GestureMode,
} from "./handTracker";
import VoiceButton, { type VoiceButtonHandle } from "./VoiceButton";
import { useAIState } from "../../features/ai/state";
import "./ultron.css";

type CameraState = "off" | "starting" | "on" | "error";
type SceneState = "initializing" | "ready";

const MODE_LABEL: Record<GestureMode, string> = {
  idle: "STANDBY",
  spin: "SPIN",
  zoom: "ZOOM",
};

const PHASE_LABEL: Record<TrackingPhase, string> = {
  calibrating: "CALIBRATING",
  tracking: "TRACKING",
};

const TRANSCRIPTION_TIMEOUT = 3000;

export default function UltronInterface() {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<OrbSceneApi | null>(null);
  const trackerRef = useRef<HandTracker | null>(null);
  const voiceRef = useRef<VoiceButtonHandle>(null);

  const [sceneState, setSceneState] = useState<SceneState>("initializing");
  const [camera, setCamera] = useState<CameraState>("off");
  const [error, setError] = useState<string | null>(null);
  const [qualityProfile] = useState<QualityProfile>("performance");

  const statusRef = useRef<TrackerStatus>({
    phase: "tracking",
    hands: 0,
    mode: "idle",
  });
  const [status, setStatus] = useState<TrackerStatus>(statusRef.current);
  const debugRef = useRef<DebugInfo>({
    trackingFPS: 0,
    inferenceMs: 0,
    hands: 0,
    leftPinch: false,
    rightPinch: false,
    delegate: "",
  });
  const [debugInfo, setDebugInfo] = useState<DebugInfo>(debugRef.current);

  const [interimText, setInterimText] = useState("");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const transTimerRef = useRef<number | undefined>(undefined);
  const voiceErrTimerRef = useRef<number | undefined>(undefined);

  const { state: aiState, submitCommand } = useAIState();
  const isProcessing =
    aiState.status === "thinking" || aiState.status === "streaming";

  // Scene setup
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const scene = createOrbScene(container, qualityProfile);
    sceneRef.current = scene;

    const raf = requestAnimationFrame(() => {
      setSceneState("ready");
    });

    return () => {
      cancelAnimationFrame(raf);
      trackerRef.current?.stop();
      trackerRef.current = null;
      scene.dispose();
      sceneRef.current = null;
    };
  }, [qualityProfile]);

  // Cleanup timers
  useEffect(() => {
    return () => {
      clearTimeout(transTimerRef.current);
      clearTimeout(voiceErrTimerRef.current);
    };
  }, []);

  // Voice callbacks
  const handleVoiceTranscript = useCallback(
    (transcript: string) => {
      const query = transcript.trim();
      if (!query) return;
      void submitCommand(query, { inputMode: "voice" });
    },
    [submitCommand],
  );

  const handleInterimTranscript = useCallback((text: string) => {
    setInterimText(text);
    clearTimeout(transTimerRef.current);
    transTimerRef.current = window.setTimeout(() => {
      setInterimText("");
    }, TRANSCRIPTION_TIMEOUT);
  }, []);

  const handleVoiceError = useCallback((message: string) => {
    setVoiceError(message);
    clearTimeout(voiceErrTimerRef.current);
    voiceErrTimerRef.current = window.setTimeout(() => {
      setVoiceError(null);
    }, 5000);
  }, []);

  const stopGestures = useCallback(() => {
    trackerRef.current?.stop();
    trackerRef.current = null;
    setCamera("off");
    statusRef.current = { phase: "tracking", hands: 0, mode: "idle" };
    setStatus(statusRef.current);
    debugRef.current = {
      trackingFPS: 0,
      inferenceMs: 0,
      hands: 0,
      leftPinch: false,
      rightPinch: false,
      delegate: "",
    };
    setDebugInfo(debugRef.current);
  }, []);

  const startGestures = useCallback(async () => {
    const video = videoRef.current;
    const overlay = overlayRef.current;
    if (!video || !overlay || trackerRef.current) return;

    setCamera("starting");
    setError(null);

    const tracker = new HandTracker(video, overlay, {
      onRotate: (dt, dp) => sceneRef.current?.rotateBy(dt, dp),
      onZoom: (factor) => sceneRef.current?.zoomBy(factor),
      onStatus: (s) => {
        statusRef.current = s;
        setStatus(s);
      },
      onDebug: (d) => {
        debugRef.current = d;
        setDebugInfo(d);
      },
    });
    trackerRef.current = tracker;

    try {
      await tracker.start();
      setCamera("on");
    } catch (err) {
      trackerRef.current = null;
      tracker.stop();
      setCamera("error");
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setError("CAMERA ACCESS DENIED");
      } else {
        setError("TRACKING INIT FAILED");
      }
    }
  }, []);

  const toggleGestures = useCallback(() => {
    if (trackerRef.current) stopGestures();
    else void startGestures();
  }, [startGestures, stopGestures]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case "+":
        case "=":
          sceneRef.current?.zoomIn();
          break;
        case "-":
        case "_":
          sceneRef.current?.zoomOut();
          break;
        case "r":
        case "R":
          sceneRef.current?.resetView();
          break;
        case "g":
        case "G":
          toggleGestures();
          break;
        case "Escape":
          if (voiceRef.current?.isListening) {
            voiceRef.current.stopListening();
          }
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleGestures]);

  const cameraOn = camera === "on";
  const btnLabel =
    camera === "starting"
      ? "INITIALIZING…"
      : camera === "error"
        ? "CAMERA ERROR"
        : cameraOn
          ? "GESTURES ON"
          : "GESTURES OFF";

  const statusLine =
    status.phase === "calibrating"
      ? "CALIBRATING…"
      : status.hands > 0
        ? `${status.hands} HAND${status.hands > 1 ? "S" : ""} · ${MODE_LABEL[status.mode]}`
        : "NO HAND";

  const devOverlay = import.meta.env.DEV && cameraOn;

  return (
    <>
      <div ref={containerRef} className="orb-root" />

      <div className="overlay-vignette" />
      <div className="overlay-grain" />
      <div className="overlay-scanlines" />

      <div className="hud hud-title">
        F.R.I.D.A.Y.
        {isProcessing && <span className="hud-processing">PROCESSING</span>}
      </div>

      <div className="hud hud-hint">
        <div>
          <span className="key">DRAG</span> spin&nbsp;&nbsp;
          <span className="key">SCROLL</span> zoom
        </div>
        {cameraOn ? (
          <div>
            <span className="key">PINCH + MOVE</span> spin&nbsp;&nbsp;
            <span className="key">PINCH BOTH ± SPREAD</span> zoom
          </div>
        ) : (
          <div>
            <span className="key">G</span> hand gestures&nbsp;&nbsp;
            <span className="key">R</span> reset&nbsp;&nbsp;
            <span className="key">+/−</span> zoom
          </div>
        )}
      </div>

      <div className="hud hud-status">
        <span className={`hud-status-dot hud-status-dot--${sceneState}`} />
        {sceneState === "ready" ? "READY" : "LOADING"}
      </div>

      <div className="hud hud-controls">
        <div className={`camera-panel${cameraOn ? " visible" : ""}`}>
          <video
            ref={videoRef}
            muted
            playsInline
            className="camera-video"
          />
          <canvas
            ref={overlayRef}
            width={208}
            height={117}
            className="camera-overlay"
          />
          <div className="camera-status">{statusLine}</div>
        </div>

        {error && <div className="hud-error">{error}</div>}

        {voiceError && <div className="hud-error">{voiceError}</div>}

        {devOverlay && (
          <div className="hud-debug">
            <span>{debugInfo.trackingFPS}fps</span>
            <span>{debugInfo.inferenceMs}ms</span>
            <span>H:{debugInfo.hands}</span>
            <span>
              {debugInfo.leftPinch ? "L▸" : "L "}
              {debugInfo.rightPinch ? "R▸" : "R "}
            </span>
            <span>{debugInfo.delegate}</span>
          </div>
        )}

        {cameraOn && (
          <div className="hud-row">
            <span className="hud-phase-label">
              {PHASE_LABEL[status.phase]}
            </span>
          </div>
        )}

        {interimText && (
          <div className="hud-transcription">{interimText}</div>
        )}

        <div className="hud-row">
          <button
            type="button"
            className="hud-btn"
            aria-pressed={cameraOn}
            onClick={toggleGestures}
            disabled={camera === "starting"}
          >
            {btnLabel}
          </button>
        </div>
        <div className="hud-row hud-row--controls">
          <VoiceButton
            ref={voiceRef}
            onTranscript={handleVoiceTranscript}
            onInterimTranscript={handleInterimTranscript}
            onError={handleVoiceError}
          />
          <button
            type="button"
            className="hud-btn"
            onClick={() => sceneRef.current?.zoomIn()}
            aria-label="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            className="hud-btn"
            onClick={() => sceneRef.current?.zoomOut()}
            aria-label="Zoom out"
          >
            &minus;
          </button>
          <button
            type="button"
            className="hud-btn"
            onClick={() => sceneRef.current?.resetView()}
          >
            RESET
          </button>
        </div>
      </div>
    </>
  );
}
