import {
  FilesetResolver,
  HandLandmarker,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";

const WASM_CDN =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const CAM_W = 640;
const CAM_H = 360;
const TARGET_FPS = 15;
const INFERENCE_INTERVAL = 1000 / TARGET_FPS;

const LM = {
  WRIST: 0,
  THUMB_TIP: 4,
  INDEX_TIP: 8,
  INDEX_MCP: 5,
  MIDDLE_MCP: 9,
} as const;

const FILTER_LM_COUNT = 5;
const C = 3;
const FILTERS_PER_HAND = FILTER_LM_COUNT * C;

const FI = {
  WRIST: 0,
  THUMB_TIP: 3,
  INDEX_TIP: 6,
  INDEX_MCP: 9,
  MIDDLE_MCP: 12,
};

const PINCH_ON = 0.32;
const PINCH_OFF = 0.43;
const PINCH_STREAK_START = 2;
const PINCH_STREAK_END = 3;
const ROTATE_SPEED = 5.0;
const DEAD_ZONE = 0.008;
const GHOST_TIMEOUT = 150;
const CALIBRATION_MS = 2000;
const MAX_HANDS = 2;

const OEF_MIN_CUTOFF = 1.2;
const OEF_BETA = 0.035;
const OEF_DERIV_CUTOFF = 1.0;

class OneEuroFilter {
  private x = 0;
  private dx = 0;
  private prevX = 0;
  private prevTime = 0;
  private initialized = false;

  constructor(
    private minCutoff: number,
    private beta: number,
    private derivativeCutoff: number,
  ) {}

  filter(value: number, time: number): number {
    if (!this.initialized) {
      this.x = value;
      this.prevX = value;
      this.prevTime = time;
      this.initialized = true;
      return value;
    }
    const dt = Math.max(0.001, (time - this.prevTime) / 1000);
    this.prevTime = time;
    const rawDx = (value - this.prevX) / dt;
    this.prevX = value;
    const ad = (2 * Math.PI * this.derivativeCutoff * dt) /
      (2 * Math.PI * this.derivativeCutoff * dt + 1);
    this.dx = ad * rawDx + (1 - ad) * this.dx;
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    const a = (2 * Math.PI * cutoff * dt) /
      (2 * Math.PI * cutoff * dt + 1);
    this.x = a * value + (1 - a) * this.x;
    return this.x;
  }

  reset() {
    this.initialized = false;
    this.dx = 0;
  }
}

export type GestureMode = "idle" | "spin" | "zoom";
export type TrackingPhase = "calibrating" | "tracking";

export interface TrackerStatus {
  phase: TrackingPhase;
  hands: number;
  mode: GestureMode;
}

export interface DebugInfo {
  trackingFPS: number;
  inferenceMs: number;
  hands: number;
  leftPinch: boolean;
  rightPinch: boolean;
  delegate: string;
}

export interface HandTrackerCallbacks {
  onRotate(deltaTheta: number, deltaPhi: number): void;
  onZoom(factor: number): void;
  onStatus(status: TrackerStatus): void;
  onDebug?(info: DebugInfo): void;
}

interface HandData {
  filters: OneEuroFilter[];
  filtered: Float64Array;
  pinching: boolean;
  pinchStreak: number;
  openStreak: number;
  lastSeen: number;
  active: boolean;
  prevGrabX: number;
  prevGrabY: number;
  hasPrevGrab: boolean;
}

function createHandData(): HandData {
  const filters: OneEuroFilter[] = [];
  for (let i = 0; i < FILTERS_PER_HAND; i++) {
    filters.push(new OneEuroFilter(OEF_MIN_CUTOFF, OEF_BETA, OEF_DERIV_CUTOFF));
  }
  return {
    filters,
    filtered: new Float64Array(FILTERS_PER_HAND),
    pinching: false,
    pinchStreak: 0,
    openStreak: 0,
    lastSeen: 0,
    active: false,
    prevGrabX: 0,
    prevGrabY: 0,
    hasPrevGrab: false,
  };
}

export class HandTracker {
  private video: HTMLVideoElement;
  private overlay: HTMLCanvasElement;
  private callbacks: HandTrackerCallbacks;
  private landmarker: HandLandmarker | null = null;
  private stream: MediaStream | null = null;
  private delegate = "CPU";
  private running = false;
  private busy = false;
  private videoTime = -1;

  private hands = new Map<string, HandData>();
  private prevMode: GestureMode = "idle";
  private prevSpinGrabX = 0;
  private prevSpinGrabY = 0;
  private hasPrevSpinGrab = false;
  private prevZoomDist = 0;
  private hasPrevZoomDist = false;

  private timerId = 0;
  private rvfcId = 0;
  private useRVFC = "requestVideoFrameCallback" in HTMLVideoElement.prototype;
  private lastInferenceTime = 0;
  private inferenceMsAvg = 0;
  private frameCount = 0;
  private fpsTime = 0;

  private calibrationStart = 0;
  private calibration = false;

  private prevStatus: TrackerStatus | null = null;
  private status: TrackerStatus = { phase: "calibrating", hands: 0, mode: "idle" };

  constructor(
    video: HTMLVideoElement,
    overlay: HTMLCanvasElement,
    callbacks: HandTrackerCallbacks,
  ) {
    this.video = video;
    this.overlay = overlay;
    this.callbacks = callbacks;
  }

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: CAM_W, height: CAM_H, facingMode: "user" },
      audio: false,
    });
    this.video.srcObject = this.stream;
    await this.video.play();

    const fileset = await FilesetResolver.forVisionTasks(WASM_CDN);

    try {
      this.landmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: MODEL_URL,
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numHands: 2,
        minHandDetectionConfidence: 0.55,
        minHandPresenceConfidence: 0.55,
        minTrackingConfidence: 0.5,
      });
      this.delegate = "GPU";
    } catch {
      this.landmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: MODEL_URL,
          delegate: "CPU",
        },
        runningMode: "VIDEO",
        numHands: 2,
        minHandDetectionConfidence: 0.55,
        minHandPresenceConfidence: 0.55,
        minTrackingConfidence: 0.5,
      });
      this.delegate = "CPU";
    }

    const now = performance.now();
    this.running = true;
    this.lastInferenceTime = now;
    this.fpsTime = now;
    this.frameCount = 0;
    this.inferenceMsAvg = 0;
    this.calibrationStart = now;
    this.calibration = true;
    this.emitStatus();
    this.scheduleNext();
  }

  stop(): void {
    this.running = false;
    if (this.useRVFC && this.rvfcId) {
      this.video.cancelVideoFrameCallback(this.rvfcId);
    }
    clearTimeout(this.timerId);
    this.landmarker?.close();
    this.landmarker = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.hands.clear();
    this.prevMode = "idle";
    this.hasPrevSpinGrab = false;
    this.hasPrevZoomDist = false;
    this.busy = false;
    const ctx = this.overlay.getContext("2d");
    ctx?.clearRect(0, 0, this.overlay.width, this.overlay.height);
    this.status = { phase: "calibrating", hands: 0, mode: "idle" };
    this.prevStatus = null;
    this.emitStatus();
  }

  private scheduleNext(): void {
    if (!this.running) return;
    if (this.useRVFC) {
      this.rvfcId = this.video.requestVideoFrameCallback(this.onVideoFrame);
    } else {
      const now = performance.now();
      const delay = Math.max(0, INFERENCE_INTERVAL - (now - this.lastInferenceTime));
      this.timerId = window.setTimeout(this.onTimer, delay);
    }
  }

  private onVideoFrame = (now: number): void => {
    if (!this.running || this.busy) {
      if (this.running) this.scheduleNext();
      return;
    }
    if (now - this.lastInferenceTime < INFERENCE_INTERVAL) {
      this.scheduleNext();
      return;
    }
    this.runInference(now);
  };

  private onTimer = (): void => {
    if (!this.running || this.busy) {
      if (this.running) this.scheduleNext();
      return;
    }
    const now = performance.now();
    if (now - this.lastInferenceTime < INFERENCE_INTERVAL) {
      this.scheduleNext();
      return;
    }
    if (this.video.readyState < 2) {
      this.scheduleNext();
      return;
    }
    if (this.video.currentTime === this.videoTime) {
      this.scheduleNext();
      return;
    }
    this.videoTime = this.video.currentTime;
    this.runInference(now);
  };

  private runInference(now: number): void {
    this.busy = true;
    this.lastInferenceTime = now;

    const t0 = performance.now();
    const result = this.landmarker!.detectForVideo(this.video, now);
    const t1 = performance.now();

    const infMs = t1 - t0;
    this.inferenceMsAvg = this.inferenceMsAvg === 0
      ? infMs
      : this.inferenceMsAvg * 0.9 + infMs * 0.1;

    this.frameCount++;
    if (t1 - this.fpsTime >= 1000) {
      this.fpsTime = t1;
      this.frameCount = 0;
    }

    this.processHands(result.landmarks, result.handedness, t1);
    this.drawOverlay(result.landmarks);

    this.busy = false;
    this.scheduleNext();
  }

  private processHands(
    landmarks: NormalizedLandmark[][],
    handedness: { categoryName?: string }[][],
    now: number,
  ): void {
    const seen = new Set<string>();
    let pinchingCount = 0;

    type GrabPt = { x: number; y: number };
    const grabPts: GrabPt[] = [];

    for (let hi = 0; hi < landmarks.length && hi < MAX_HANDS; hi++) {
      const lm = landmarks[hi];
      const label = handedness[hi]?.[0]?.categoryName ?? `h${hi}`;
      seen.add(label);

      let hd = this.hands.get(label);
      if (!hd) {
        hd = createHandData();
        this.hands.set(label, hd);
      }

      // Filter landmarks
      for (let li = 0; li < FILTER_LM_COUNT; li++) {
        const lmIdx = [LM.WRIST, LM.THUMB_TIP, LM.INDEX_TIP, LM.INDEX_MCP, LM.MIDDLE_MCP][li];
        const base = li * C;
        const rawX = 1 - lm[lmIdx].x; // mirror X for user perspective
        const rawY = lm[lmIdx].y;
        const rawZ = lm[lmIdx].z ?? 0;
        hd.filtered[base] = hd.filters[base].filter(rawX, now);
        hd.filtered[base + 1] = hd.filters[base + 1].filter(rawY, now);
        hd.filtered[base + 2] = hd.filters[base + 2].filter(rawZ, now);
      }

      hd.lastSeen = now;
      hd.active = true;

      // Palm centre: midpoint of filtered wrist and middle MCP
      const wristX = hd.filtered[FI.WRIST];
      const wristY = hd.filtered[FI.WRIST + 1];
      const mcpX = hd.filtered[FI.MIDDLE_MCP];
      const mcpY = hd.filtered[FI.MIDDLE_MCP + 1];
      const palmCX = (wristX + mcpX) / 2;
      const palmCY = (wristY + mcpY) / 2;

      // Palm width (wrist to middle MCP) for pinch normalisation
      const palmW = Math.hypot(mcpX - wristX, mcpY - wristY);

      // Pinch distance (filtered thumb tip to index tip)
      const ttX = hd.filtered[FI.THUMB_TIP];
      const ttY = hd.filtered[FI.THUMB_TIP + 1];
      const itX = hd.filtered[FI.INDEX_TIP];
      const itY = hd.filtered[FI.INDEX_TIP + 1];
      const pinchD = Math.hypot(itX - ttX, itY - ttY);
      const pinchRatio = palmW > 1e-6 ? pinchD / palmW : 1;

      // Pinch state machine with hysteresis + streak debounce
      if (hd.pinching) {
        if (pinchRatio > PINCH_OFF) {
          hd.openStreak++;
          if (hd.openStreak >= PINCH_STREAK_END) {
            hd.pinching = false;
            hd.openStreak = 0;
            hd.hasPrevGrab = false;
          }
        } else {
          hd.openStreak = 0;
        }
      } else {
        if (pinchRatio < PINCH_ON) {
          hd.pinchStreak++;
          if (hd.pinchStreak >= PINCH_STREAK_START) {
            hd.pinching = true;
            hd.pinchStreak = 0;
          }
        } else {
          hd.pinchStreak = 0;
        }
      }

      if (hd.pinching) {
        pinchingCount++;
        grabPts.push({ x: palmCX, y: palmCY });
      }
    }

    // Ghost hand management
    for (const [label, hd] of this.hands) {
      if (seen.has(label)) continue;
      if (hd.active && (now - hd.lastSeen) < GHOST_TIMEOUT) {
        hd.pinching = false;
        hd.pinchStreak = 0;
        hd.openStreak = 0;
      } else {
        hd.active = false;
      }
    }

    // Determine gesture mode
    const mode: GestureMode =
      pinchingCount >= 2 ? "zoom" : pinchingCount === 1 ? "spin" : "idle";

    // Gesture dispatch
    if (mode !== this.prevMode) {
      this.hasPrevSpinGrab = false;
      this.hasPrevZoomDist = false;
      this.prevMode = mode;
    }

    if (!this.calibration) {
      if (mode === "spin" && grabPts.length >= 1) {
        const gx = grabPts[0].x;
        const gy = grabPts[0].y;
        if (this.hasPrevSpinGrab) {
          const dx = gx - this.prevSpinGrabX;
          const dy = gy - this.prevSpinGrabY;
          if (Math.abs(dx) > DEAD_ZONE || Math.abs(dy) > DEAD_ZONE) {
            this.callbacks.onRotate(dx * ROTATE_SPEED, dy * ROTATE_SPEED);
          }
        }
        this.prevSpinGrabX = gx;
        this.prevSpinGrabY = gy;
        this.hasPrevSpinGrab = true;
      } else if (mode === "zoom" && grabPts.length >= 2) {
        const d = Math.hypot(
          grabPts[1].x - grabPts[0].x,
          grabPts[1].y - grabPts[0].y,
        );
        if (this.hasPrevZoomDist && d > DEAD_ZONE) {
          const factor = Math.min(1.18, Math.max(0.85, this.prevZoomDist / d));
          this.callbacks.onZoom(factor);
        }
        this.prevZoomDist = d;
        this.hasPrevZoomDist = true;
      }
    }

    // Calibration check
    if (this.calibration && (now - this.calibrationStart) >= CALIBRATION_MS) {
      this.calibration = false;
    }

    const activeCount = this.countActive();
    this.status = {
      phase: this.calibration ? "calibrating" : "tracking",
      hands: activeCount,
      mode,
    };
    this.emitStatus();
    this.emitDebug();
  }

  private countActive(): number {
    let count = 0;
    for (const hd of this.hands.values()) {
      if (hd.active) count++;
    }
    return count;
  }

  private emitStatus(): void {
    const s = this.status;
    if (
      this.prevStatus &&
      this.prevStatus.phase === s.phase &&
      this.prevStatus.hands === s.hands &&
      this.prevStatus.mode === s.mode
    ) {
      return;
    }
    this.prevStatus = { ...s };
    this.callbacks.onStatus(s);
  }

  private emitDebug(): void {
    if (!this.callbacks.onDebug) return;
    let leftPinch = false;
    let rightPinch = false;
    for (const [label, hd] of this.hands) {
      if (!hd.active) continue;
      if (label === "Left") leftPinch = hd.pinching;
      if (label === "Right") rightPinch = hd.pinching;
    }
    this.callbacks.onDebug({
      trackingFPS: TARGET_FPS,
      inferenceMs: Math.round(this.inferenceMsAvg),
      hands: this.countActive(),
      leftPinch,
      rightPinch,
      delegate: this.delegate,
    });
  }

  private drawOverlay(landmarks: NormalizedLandmark[][]): void {
    const ctx = this.overlay.getContext("2d");
    if (!ctx) return;
    const { width, height } = this.overlay;
    ctx.clearRect(0, 0, width, height);

    for (let hi = 0; hi < landmarks.length && hi < MAX_HANDS; hi++) {
      const lm = landmarks[hi];
      const tx = (1 - lm[LM.THUMB_TIP].x) * width;
      const ty = lm[LM.THUMB_TIP].y * height;
      const ix = (1 - lm[LM.INDEX_TIP].x) * width;
      const iy = lm[LM.INDEX_TIP].y * height;

      const ws = Math.hypot(
        lm[LM.WRIST].x - lm[LM.MIDDLE_MCP].x,
        lm[LM.WRIST].y - lm[LM.MIDDLE_MCP].y,
      );
      const pd = Math.hypot(
        lm[LM.THUMB_TIP].x - lm[LM.INDEX_TIP].x,
        lm[LM.THUMB_TIP].y - lm[LM.INDEX_TIP].y,
      );
      const pinched = ws > 1e-6 && (pd / ws) < PINCH_ON;

      ctx.strokeStyle = pinched ? "#ffcc66" : "rgba(255,170,48,0.5)";
      ctx.lineWidth = pinched ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(ix, iy);
      ctx.stroke();

      ctx.fillStyle = pinched ? "#ffcc66" : "rgba(255,170,48,0.7)";
      ctx.beginPath();
      ctx.arc(tx, ty, pinched ? 5 : 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(ix, iy, pinched ? 5 : 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
