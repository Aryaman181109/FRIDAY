/*
 * MIT License
 * Copyright (c) 2026 Sagar Tamang
 *
 * Adapted from ULTRON Orb UI for FRIDAY desktop assistant.
 * Licence: https://github.com/SAGAR-TAMANG/ultron-by-sagar-builds/blob/main/LICENSE
 */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

export type QualityProfile = "performance" | "balanced" | "cinematic";

export interface QualityConfig {
  dpr: number;
  antialias: boolean;
  bloomStrength: number;
  dustCount: number;
  debrisCount: number;
  textOuter: number;
  textInner: number;
  textAmbient: number;
  ringSegs: number;
  meridianSegs: number;
  latSegs: number;
  crossLines: number;
  eqLines: number;
  targetFPS: number;
  chromaticAberration: boolean;
}

const QUALITY: Record<QualityProfile, QualityConfig> = {
  performance: {
    dpr: 1,
    antialias: false,
    bloomStrength: 1.8,
    dustCount: 800,
    debrisCount: 100,
    textOuter: 500,
    textInner: 50,
    textAmbient: 150,
    ringSegs: 48,
    meridianSegs: 48,
    latSegs: 48,
    crossLines: 8,
    eqLines: 8,
    targetFPS: 45,
    chromaticAberration: false,
  },
  balanced: {
    dpr: 1.5,
    antialias: true,
    bloomStrength: 1.8,
    dustCount: 1200,
    debrisCount: 150,
    textOuter: 800,
    textInner: 75,
    textAmbient: 250,
    ringSegs: 64,
    meridianSegs: 64,
    latSegs: 64,
    crossLines: 12,
    eqLines: 14,
    targetFPS: 60,
    chromaticAberration: true,
  },
  cinematic: {
    dpr: 2,
    antialias: true,
    bloomStrength: 1.8,
    dustCount: 2000,
    debrisCount: 250,
    textOuter: 1200,
    textInner: 100,
    textAmbient: 400,
    ringSegs: 120,
    meridianSegs: 120,
    latSegs: 120,
    crossLines: 18,
    eqLines: 20,
    targetFPS: 60,
    chromaticAberration: true,
  },
};

export interface OrbSceneApi {
  rotateBy(deltaTheta: number, deltaPhi: number): void;
  zoomBy(factor: number): void;
  zoomIn(): void;
  zoomOut(): void;
  resetView(): void;
  dispose(): void;
  setQuality(profile: QualityProfile): void;
}

const HOME_POSITION = new THREE.Vector3(0, 0.5, 5.5);
const MIN_DISTANCE = 0.6;
const MAX_DISTANCE = 40;

export function createOrbScene(
  container: HTMLElement,
  initialQuality: QualityProfile = "performance",
): OrbSceneApi {
  const width = container.clientWidth;
  const height = container.clientHeight;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 500);
  camera.position.copy(HOME_POSITION);

  let config = QUALITY[initialQuality];

  const renderer = new THREE.WebGLRenderer({
    antialias: config.antialias,
    powerPreference: "high-performance",
  });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, config.dpr));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.8;
  container.appendChild(renderer.domElement);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(width, height),
    config.bloomStrength,
    0.4,
    0.2,
  );
  composer.addPass(bloom);

  let chromaticPass: ShaderPass | null = null;
  if (config.chromaticAberration) {
    chromaticPass = createChromaticPass();
    composer.addPass(chromaticPass);
  }

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.04;
  controls.minDistance = MIN_DISTANCE;
  controls.maxDistance = MAX_DISTANCE;
  controls.zoomSpeed = 1.4;
  controls.enablePan = false;

  const C_BRIGHT = 0xffaa30;
  const C_MID = 0xdd7700;
  const C_DIM = 0x884400;
  const C_FAINT = 0x553300;
  const C_HOT = 0xffcc66;

  const orbGroup = new THREE.Group();
  scene.add(orbGroup);

  function lineMat(color: number, opacity = 1) {
    return new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }

  function latRing(radius: number, lat: number, segs: number) {
    const r = radius * Math.cos(lat);
    const y = radius * Math.sin(lat);
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      pts.push(new THREE.Vector3(r * Math.cos(a), y, r * Math.sin(a)));
    }
    return new THREE.BufferGeometry().setFromPoints(pts);
  }

  function meridian(radius: number, lon: number, segs: number) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= segs; i++) {
      const lat = (i / segs) * Math.PI - Math.PI / 2;
      pts.push(
        new THREE.Vector3(
          radius * Math.cos(lat) * Math.cos(lon),
          radius * Math.sin(lat),
          radius * Math.cos(lat) * Math.sin(lon),
        ),
      );
    }
    return new THREE.BufferGeometry().setFromPoints(pts);
  }

  const outerShell = new THREE.Group();
  const R1 = 2.0;

  const latCount = config.latSegs <= 48 ? 10 : 15;
  for (let i = -latCount; i <= latCount; i++) {
    const lat = (i / latCount) * (Math.PI / 2) * 0.95;
    const opacity = i % 3 === 0 ? 0.5 : 0.12;
    const color = i % 3 === 0 ? C_MID : C_FAINT;
    outerShell.add(new THREE.Line(latRing(R1, lat, config.latSegs), lineMat(color, opacity)));
  }

  const meridianCount = config.meridianSegs <= 48 ? 16 : 24;
  for (let i = 0; i < meridianCount; i++) {
    const lon = (i / meridianCount) * Math.PI * 2;
    const isMajor = i % 4 === 0;
    outerShell.add(
      new THREE.Line(
        meridian(R1, lon, config.meridianSegs),
        lineMat(isMajor ? C_MID : C_FAINT, isMajor ? 0.6 : 0.1),
      ),
    );
  }

  for (let i = 0; i < 4; i++) {
    const lon = (i / 4) * Math.PI * 2;
    for (let j = 0; j < config.crossLines; j++) {
      const t = (j / Math.max(1, config.crossLines - 1)) * 2 - 1;
      const offset = (t * 0.25) / 2;
      const falloff = 1 - Math.abs(t) * 0.7;
      const opacity = 0.85 * falloff;
      const color = Math.abs(t) < 0.3 ? C_BRIGHT : C_MID;
      outerShell.add(
        new THREE.Line(meridian(R1, lon + offset, config.meridianSegs), lineMat(color, opacity)),
      );
    }
  }

  for (let j = 0; j < config.eqLines; j++) {
    const t = (j / Math.max(1, config.eqLines - 1)) * 2 - 1;
    const offset = (t * 0.35) / 2;
    const falloff = 1 - Math.abs(t) * 0.65;
    const opacity = 0.8 * falloff;
    const color = Math.abs(t) < 0.3 ? C_BRIGHT : C_MID;
    outerShell.add(
      new THREE.Line(latRing(R1, offset, config.latSegs), lineMat(color, opacity)),
    );
  }

  orbGroup.add(outerShell);

  const panelGroup = new THREE.Group();

  function createSpherePanel(
    latCenter: number,
    lonCenter: number,
    latSpan: number,
    lonSpan: number,
    radius: number,
    divisions = 4,
  ) {
    const group = new THREE.Group();
    const mat = lineMat(C_DIM, 0.25);
    const d = Math.max(2, divisions);

    for (let i = 0; i <= d; i++) {
      const lat = latCenter - latSpan / 2 + (i / d) * latSpan;
      const pts: THREE.Vector3[] = [];
      const pCount = d * 4;
      for (let j = 0; j <= pCount; j++) {
        const lon = lonCenter - lonSpan / 2 + (j / pCount) * lonSpan;
        pts.push(
          new THREE.Vector3(
            radius * Math.cos(lat) * Math.cos(lon),
            radius * Math.sin(lat),
            radius * Math.cos(lat) * Math.sin(lon),
          ),
        );
      }
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
    }

    for (let j = 0; j <= d; j++) {
      const lon = lonCenter - lonSpan / 2 + (j / d) * lonSpan;
      const pts: THREE.Vector3[] = [];
      const pCount = d * 4;
      for (let i = 0; i <= pCount; i++) {
        const lat = latCenter - latSpan / 2 + (i / pCount) * latSpan;
        pts.push(
          new THREE.Vector3(
            radius * Math.cos(lat) * Math.cos(lon),
            radius * Math.sin(lat),
            radius * Math.cos(lat) * Math.sin(lon),
          ),
        );
      }
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
    }

    return group;
  }

  const panelCount = config.debrisCount <= 100 ? 15 : 30;
  for (let i = 0; i < panelCount; i++) {
    const lat = (Math.random() - 0.5) * Math.PI * 0.8;
    const lon = Math.random() * Math.PI * 2;
    const size = 0.15 + Math.random() * 0.25;
    const panel = createSpherePanel(
      lat,
      lon,
      size,
      size,
      R1 + 0.01,
      2 + Math.floor(Math.random() * (config.latSegs <= 48 ? 1 : 3)),
    );
    panelGroup.add(panel);
  }
  orbGroup.add(panelGroup);

  const shell2 = new THREE.Group();
  const R2 = 2.12;

  const arcCount = config.debrisCount <= 100 ? 8 : 16;
  for (let i = 0; i < arcCount; i++) {
    const lat = (Math.random() - 0.5) * Math.PI * 0.85;
    const startLon = Math.random() * Math.PI * 2;
    const arcLen = 0.3 + Math.random() * 1.2;
    const pts: THREE.Vector3[] = [];
    const segs = config.ringSegs;
    const r = R2 * Math.cos(lat);
    const y = R2 * Math.sin(lat);
    for (let j = 0; j <= segs; j++) {
      const a = startLon + (j / segs) * arcLen;
      pts.push(new THREE.Vector3(r * Math.cos(a), y, r * Math.sin(a)));
    }
    shell2.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        lineMat(C_MID, 0.2 + Math.random() * 0.3),
      ),
    );
  }

  const merArcCount = config.debrisCount <= 100 ? 6 : 12;
  for (let i = 0; i < merArcCount; i++) {
    const lon = Math.random() * Math.PI * 2;
    const startLat = (Math.random() - 0.5) * Math.PI * 0.8;
    const arcLen = 0.3 + Math.random() * 0.8;
    const pts: THREE.Vector3[] = [];
    const segs = config.ringSegs;
    for (let j = 0; j <= segs; j++) {
      const lat = startLat + (j / segs) * arcLen;
      pts.push(
        new THREE.Vector3(
          R2 * Math.cos(lat) * Math.cos(lon),
          R2 * Math.sin(lat),
          R2 * Math.cos(lat) * Math.sin(lon),
        ),
      );
    }
    shell2.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        lineMat(C_DIM, 0.15 + Math.random() * 0.2),
      ),
    );
  }
  orbGroup.add(shell2);

  const innerCore = new THREE.Group();
  const R3 = 0.9;

  const spiralCount = config.debrisCount <= 100 ? 5 : 8;
  for (let s = 0; s < spiralCount; s++) {
    const pts: THREE.Vector3[] = [];
    const turns = 3 + Math.random() * 2;
    const segs = config.latSegs * 6;
    const phase = (s / spiralCount) * Math.PI * 2;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const lat = t * Math.PI - Math.PI / 2;
      const lon = t * turns * Math.PI * 2 + phase;
      pts.push(
        new THREE.Vector3(
          R3 * Math.cos(lat) * Math.cos(lon),
          R3 * Math.sin(lat),
          R3 * Math.cos(lat) * Math.sin(lon),
        ),
      );
    }
    innerCore.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        lineMat(C_BRIGHT, 0.3 + Math.random() * 0.2),
      ),
    );
  }

  const innerLatCount = config.latSegs <= 48 ? 4 : 6;
  for (let i = -innerLatCount; i <= innerLatCount; i++) {
    const lat = (i / Math.max(1, innerLatCount)) * (Math.PI / 2) * 0.9;
    innerCore.add(new THREE.Line(latRing(R3, lat, config.ringSegs), lineMat(C_DIM, 0.2)));
  }

  const innerMerCount = config.meridianSegs <= 48 ? 8 : 12;
  for (let i = 0; i < innerMerCount; i++) {
    const lon = (i / innerMerCount) * Math.PI * 2;
    innerCore.add(new THREE.Line(meridian(R3, lon, config.ringSegs), lineMat(C_DIM, 0.15)));
  }

  orbGroup.add(innerCore);

  const coreR = 0.25;

  const icoGeo = new THREE.IcosahedronGeometry(coreR, 1);
  const icoEdges = new THREE.EdgesGeometry(icoGeo);
  const icoWireMat = lineMat(C_HOT, 0.9);
  const icoWire = new THREE.LineSegments(icoEdges, icoWireMat);
  orbGroup.add(icoWire);

  const coreSphereMat = new THREE.MeshBasicMaterial({
    color: C_HOT,
    transparent: true,
    opacity: 0.15,
    blending: THREE.AdditiveBlending,
  });
  const coreSphere = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 16), coreSphereMat);
  orbGroup.add(coreSphere);

  const glowSphereMat = new THREE.MeshBasicMaterial({
    color: C_MID,
    transparent: true,
    opacity: 0.04,
    blending: THREE.AdditiveBlending,
  });
  const glowSphere = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 16), glowSphereMat);
  orbGroup.add(glowSphere);

  const codeSnippets = [
    "sys.init()", "0xFF3A", "malloc()", ">> SCAN", "void*", "ACK",
    "SYNC OK", "ptr_ref", "exec()", "hash256", "::bind", "core.0",
    "01101001", "10110100", ">>> RDY", "HEAP 4K", "TCP/SYN",
    "mutex.lk", "IRQ 0x7", "DMA xfer", "REG EAX", "FAULT 0",
    "kernel.d", "pipe |>", "chmod +x", "fork()", "SIGTERM",
    "eth0: UP", "AES-256", "RSA 4096", "TLS 1.3", "HTTP/2",
    "latency", "200 OK", "PATCH /", "fn main", "use std",
    "impl Orb", "async {}", "spawn()", "arc::new", ".unwrap",
  ];

  interface SpriteDrift {
    phi: number;
    theta: number;
    r: number;
    speed: number;
  }

  function makeTextSprite(text: string, size = 0.08) {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 32;
    const ctx = c.getContext("2d")!;
    ctx.font = "bold 14px Courier New";
    const alpha = 0.35 + Math.random() * 0.55;
    ctx.fillStyle = `rgba(255, ${(130 + Math.random() * 80) | 0}, ${(20 + Math.random() * 30) | 0}, ${alpha})`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 128, 16);
    const tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    s.scale.set(size * 5, size * 0.7, 1);
    return s;
  }

  function scatterText(
    count: number,
    sizeFn: () => number,
    rFn: () => number,
    speedScale: [number, number],
  ) {
    const group = new THREE.Group();
    for (let i = 0; i < count; i++) {
      const sp = makeTextSprite(
        codeSnippets[Math.floor(Math.random() * codeSnippets.length)],
        sizeFn(),
      );
      const phi = Math.acos(2 * Math.random() - 1);
      const theta = Math.random() * Math.PI * 2;
      const r = rFn();
      sp.position.set(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.cos(phi),
        r * Math.sin(phi) * Math.sin(theta),
      );
      sp.userData = {
        phi,
        theta,
        r,
        speed:
          (speedScale[0] + Math.random() * speedScale[1]) *
          (Math.random() > 0.5 ? 1 : -1),
      } satisfies SpriteDrift;
      group.add(sp);
    }
    return group;
  }

  const textOuter = scatterText(
    config.textOuter,
    () => 0.04 + Math.random() * 0.04,
    () => R1 + 0.03 + Math.random() * 0.08,
    [0.0002, 0.0008],
  );
  orbGroup.add(textOuter);

  const textInner = scatterText(
    config.textInner,
    () => 0.03 + Math.random() * 0.03,
    () => R3 + 0.02,
    [0.0005, 0.001],
  );
  orbGroup.add(textInner);

  const textAmbient = scatterText(
    config.textAmbient,
    () => 0.03,
    () => R3 + 0.2 + Math.random() * (R1 - R3 - 0.3),
    [0.0003, 0.0006],
  );
  orbGroup.add(textAmbient);

  const debrisGeos = [
    new THREE.IcosahedronGeometry(0.012, 0),
    new THREE.IcosahedronGeometry(0.02, 0),
    new THREE.IcosahedronGeometry(0.03, 1),
    new THREE.IcosahedronGeometry(0.008, 0),
    new THREE.TetrahedronGeometry(0.015, 0),
    new THREE.OctahedronGeometry(0.018, 0),
  ];
  interface DebrisOrbit {
    orbitR: number;
    speed: number;
    tiltX: number;
    tiltZ: number;
    phase: number;
  }
  const debris: THREE.Mesh[] = [];
  for (let i = 0; i < config.debrisCount; i++) {
    const geo = debrisGeos[Math.floor(Math.random() * debrisGeos.length)];
    const mat = new THREE.MeshBasicMaterial({
      color: Math.random() > 0.7 ? C_BRIGHT : C_MID,
      transparent: true,
      opacity: 0.3 + Math.random() * 0.6,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geo, mat);
    const orbitR = 1.2 + Math.random() * 4.0;
    const speed = (0.08 + Math.random() * 0.6) * (Math.random() > 0.5 ? 1 : -1);
    const tiltX = (Math.random() - 0.5) * Math.PI * 0.9;
    const tiltZ = (Math.random() - 0.5) * Math.PI * 0.5;
    const phase = Math.random() * Math.PI * 2;
    mesh.userData = { orbitR, speed, tiltX, tiltZ, phase } satisfies DebrisOrbit;
    debris.push(mesh);
    orbGroup.add(mesh);

    if (Math.random() > 0.85) {
      const trailPts: THREE.Vector3[] = [];
      for (let j = 0; j <= 15; j++) {
        const a = -(j / 15) * 0.3;
        trailPts.push(
          new THREE.Vector3(
            orbitR * Math.cos(a + phase),
            orbitR * 0.08 * Math.sin(a * 3),
            orbitR * Math.sin(a + phase),
          ),
        );
      }
      const trail = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(trailPts),
        lineMat(C_FAINT, 0.08),
      );
      mesh.add(trail);
    }
  }

  const dustCount = config.dustCount;
  const dustPos = new Float32Array(dustCount * 3);

  for (let i = 0; i < dustCount; i++) {
    const rr = 0.5 + Math.pow(Math.random(), 0.6) * 7;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    dustPos[i * 3] = rr * Math.sin(phi) * Math.cos(theta);
    dustPos[i * 3 + 1] = rr * Math.cos(phi);
    dustPos[i * 3 + 2] = rr * Math.sin(phi) * Math.sin(theta);
  }

  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute("position", new THREE.Float32BufferAttribute(dustPos, 3));

  const dotC = document.createElement("canvas");
  dotC.width = dotC.height = 64;
  const dCtx = dotC.getContext("2d")!;
  const g = dCtx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,170,48,1)");
  g.addColorStop(0.2, "rgba(255,120,20,0.6)");
  g.addColorStop(0.5, "rgba(200,80,0,0.15)");
  g.addColorStop(1, "rgba(100,40,0,0)");
  dCtx.fillStyle = g;
  dCtx.fillRect(0, 0, 64, 64);

  const dustMat = new THREE.PointsMaterial({
    map: new THREE.CanvasTexture(dotC),
    size: 0.04,
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
    color: C_BRIGHT,
  });
  const dustPoints = new THREE.Points(dustGeo, dustMat);
  orbGroup.add(dustPoints);

  function makeScanRing(radius: number, thickness = 0.015) {
    const segs = config.ringSegs;
    const geo = new THREE.RingGeometry(radius - thickness, radius + thickness, segs);
    const mat = new THREE.MeshBasicMaterial({
      color: C_BRIGHT,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = Math.PI / 2;
    return mesh;
  }

  const scanRing1 = makeScanRing(R1, 0.01);
  const scanRing2 = makeScanRing(R1 * 0.7, 0.008);
  orbGroup.add(scanRing1, scanRing2);

  const hexCount = config.debrisCount <= 100 ? 8 : 15;
  for (let i = 0; i < hexCount; i++) {
    const phi = Math.acos(2 * Math.random() - 1);
    const theta = Math.random() * Math.PI * 2;
    const r = R1 + 0.02;
    const hexGeo = new THREE.CircleGeometry(0.03 + Math.random() * 0.02, 6);
    const hexEdges = new THREE.EdgesGeometry(hexGeo);
    const hex = new THREE.LineSegments(hexEdges, lineMat(C_MID, 0.5));
    hex.position.set(
      r * Math.sin(phi) * Math.cos(theta),
      r * Math.cos(phi),
      r * Math.sin(phi) * Math.sin(theta),
    );
    hex.lookAt(0, 0, 0);
    outerShell.add(hex);
  }

  // Velocity-aware gesture rotation accumulator
  let pendingTheta = 0;
  let pendingPhi = 0;
  let lastGestureTime = 0;
  let gestureVelocity = 0;

  const sphericalScratch = new THREE.Spherical();
  const offsetScratch = new THREE.Vector3();
  const MAX_PER_FRAME = 0.5;

  function rotateBy(deltaTheta: number, deltaPhi: number) {
    pendingTheta += deltaTheta;
    pendingPhi += deltaPhi;
    const now = performance.now();
    const dt = Math.max(0.001, now - lastGestureTime);
    const mag = Math.abs(deltaTheta) + Math.abs(deltaPhi);
    gestureVelocity = gestureVelocity * 0.85 + (mag / dt) * 0.15;
    lastGestureTime = now;
  }

  function applySmoothRotation(smoothFactor: number) {
    if (Math.abs(pendingTheta) < 1e-8 && Math.abs(pendingPhi) < 1e-8) return;
    let dt = pendingTheta * smoothFactor;
    let dp = pendingPhi * smoothFactor;
    dt = Math.max(-MAX_PER_FRAME, Math.min(MAX_PER_FRAME, dt));
    dp = Math.max(-MAX_PER_FRAME, Math.min(MAX_PER_FRAME, dp));
    pendingTheta -= dt;
    pendingPhi -= dp;

    offsetScratch.copy(camera.position).sub(controls.target);
    sphericalScratch.setFromVector3(offsetScratch);
    sphericalScratch.theta -= dt;
    sphericalScratch.phi = THREE.MathUtils.clamp(
      sphericalScratch.phi - dp,
      0.05,
      Math.PI - 0.05,
    );
    sphericalScratch.makeSafe();
    offsetScratch.setFromSpherical(sphericalScratch);
    camera.position.copy(controls.target).add(offsetScratch);
    camera.lookAt(controls.target);
  }

  function getSmoothFactor(now: number): number {
    const elapsed = now - lastGestureTime;
    if (elapsed < 100) {
      return Math.min(0.5, 0.06 + gestureVelocity * 0.8);
    }
    if (elapsed > 500) return 0.02;
    const t = (elapsed - 100) / 400;
    const hi = Math.min(0.5, 0.06 + gestureVelocity * 0.8);
    return hi * (1 - t) + 0.02 * t;
  }

  function zoomBy(factor: number) {
    offsetScratch.copy(camera.position).sub(controls.target);
    const dist = THREE.MathUtils.clamp(
      offsetScratch.length() * factor,
      MIN_DISTANCE,
      MAX_DISTANCE,
    );
    offsetScratch.setLength(dist);
    camera.position.copy(controls.target).add(offsetScratch);
  }

  function resetView() {
    pendingTheta = 0;
    pendingPhi = 0;
    gestureVelocity = 0;
    lastGestureTime = 0;
    camera.position.copy(HOME_POSITION);
    controls.target.set(0, 0, 0);
    camera.lookAt(controls.target);
    controls.update();
  }

  const clock = new THREE.Clock();
  let flickerTimer = 0;
  let rafId = 0;
  let disposed = false;
  let paused = false;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // FPS limiter: target interval in ms
  let targetInterval = 1000 / config.targetFPS;
  let lastFrameTime = performance.now();

  function animate() {
    if (disposed) return;
    rafId = requestAnimationFrame(animate);

    if (paused) {
      composer.render();
      return;
    }

    const now = performance.now();
    const elapsed = now - lastFrameTime;
    if (elapsed < targetInterval) return;
    lastFrameTime = now - (elapsed % targetInterval);

    const t = clock.getElapsedTime();
    const speedMul = reducedMotion ? 0.15 : 1;

    outerShell.rotation.y += 0.0015 * speedMul;
    outerShell.rotation.x = Math.sin(t * 0.08) * 0.05 * speedMul;

    panelGroup.rotation.y += 0.0018 * speedMul;
    panelGroup.rotation.x = Math.sin(t * 0.08 + 0.5) * 0.04 * speedMul;

    shell2.rotation.y -= 0.001 * speedMul;
    shell2.rotation.z = Math.sin(t * 0.12) * 0.03 * speedMul;

    innerCore.rotation.y -= 0.005 * speedMul;
    innerCore.rotation.z += 0.002 * speedMul;
    innerCore.rotation.x = Math.cos(t * 0.1) * 0.08 * speedMul;

    icoWire.rotation.x += 0.008 * speedMul;
    icoWire.rotation.y += 0.012 * speedMul;

    const wave1 = Math.sin(t * 1.2);
    const wave3 = Math.pow(Math.max(0, Math.sin(t * 0.4)), 5);
    const wave4 = Math.pow(Math.max(0, Math.sin(t * 0.7 + 2)), 8);
    const fadeOut = Math.pow(Math.max(0, Math.sin(t * 0.25)), 3);
    const surge = wave3 * 1.5 + wave4 * 2.0;
    const coreScale = 1 + surge + Math.sin(t * 5) * 0.05;
    coreSphere.scale.setScalar(coreScale);
    const coreOpacity = Math.max(
      0,
      (0.08 + wave1 * 0.05 + surge * 0.2) * (1 - fadeOut * 0.95),
    );
    coreSphereMat.opacity = Math.min(0.6, coreOpacity);
    glowSphere.scale.setScalar(1 + surge * 0.8);
    glowSphereMat.opacity = Math.max(0, (0.03 + surge * 0.08) * (1 - fadeOut * 0.9));
    icoWire.scale.setScalar(1 + surge * 0.6);
    icoWireMat.opacity = Math.min(1, 0.5 + surge * 0.4);

    for (let i = 0; i < debris.length; i++) {
      const d = debris[i];
      const u = d.userData as DebrisOrbit;
      const a = t * u.speed * speedMul + u.phase;
      d.position.set(
        u.orbitR * Math.cos(a) * Math.cos(u.tiltX),
        u.orbitR * Math.sin(u.tiltX) * Math.sin(a * 0.8) + Math.sin(a * 0.3 + u.tiltZ) * 0.2,
        u.orbitR * Math.sin(a) * Math.cos(u.tiltZ),
      );
      d.rotation.x += 0.015 * speedMul;
      d.rotation.z += 0.01 * speedMul;
    }

    const driftGroups: [THREE.Group, number][] = [
      [textOuter, 1],
      [textInner, 2],
      [textAmbient, 1.2],
    ];
    for (let gi = 0; gi < driftGroups.length; gi++) {
      const [group, mult] = driftGroups[gi];
      const children = group.children;
      for (let ci = 0; ci < children.length; ci++) {
        const sp = children[ci];
        const u = sp.userData as SpriteDrift;
        u.theta += u.speed * mult * speedMul;
        sp.position.set(
          u.r * Math.sin(u.phi) * Math.cos(u.theta),
          u.r * Math.cos(u.phi),
          u.r * Math.sin(u.phi) * Math.sin(u.theta),
        );
      }
    }

    const scanY1 = Math.sin(t * 0.4) * R1;
    scanRing1.position.y = scanY1;
    const scanS1 = Math.sqrt(Math.max(0, R1 * R1 - scanY1 * scanY1)) / R1;
    scanRing1.scale.set(scanS1, scanS1, 1);
    (scanRing1.material as THREE.MeshBasicMaterial).opacity = 0.2 * scanS1;

    const scanY2 = Math.sin(t * 0.6 + 2) * R3;
    scanRing2.position.y = scanY2;
    const scanS2 = Math.sqrt(Math.max(0, R3 * R3 - scanY2 * scanY2)) / R3;
    scanRing2.scale.set(scanS2, scanS2, 1);
    (scanRing2.material as THREE.MeshBasicMaterial).opacity = 0.15 * scanS2;

    dustPoints.rotation.y += 0.0002 * speedMul;

    flickerTimer += targetInterval / 1000;
    if (flickerTimer > 0.1) {
      flickerTimer = 0;
      const pChildren = panelGroup.children;
      for (let i = 0; i < pChildren.length; i++) {
        if (Math.random() > 0.95) {
          pChildren[i].visible = !pChildren[i].visible;
        }
      }
    }

    bloom.strength = config.bloomStrength + Math.sin(t * 0.8) * 0.3;

    if (chromaticPass) {
      chromaticPass.uniforms.uTime.value = t;
    }

    // Velocity-aware gesture rotation application
    applySmoothRotation(getSmoothFactor(now));

    controls.update();
    composer.render();
  }

  animate();

  function onResize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
  }
  window.addEventListener("resize", onResize);

  function onVisibilityChange() {
    paused = document.hidden;
  }
  document.addEventListener("visibilitychange", onVisibilityChange);

  function dispose() {
    disposed = true;
    cancelAnimationFrame(rafId);
    window.removeEventListener("resize", onResize);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    controls.dispose();
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        if (!mat) continue;
        const anyMat = mat as THREE.Material & { map?: THREE.Texture };
        anyMat.map?.dispose();
        mat.dispose();
      }
    });
    composer.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }

  function setQuality(profile: QualityProfile) {
    config = QUALITY[profile];
    targetInterval = 1000 / config.targetFPS;
  }

  return {
    rotateBy,
    zoomBy,
    zoomIn: () => zoomBy(0.65),
    zoomOut: () => zoomBy(1.55),
    resetView,
    dispose,
    setQuality,
  };
}

function createChromaticPass(): ShaderPass {
  const shader = {
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uIntensity: { value: 0.003 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform float uTime;
      uniform float uIntensity;
      varying vec2 vUv;
      void main() {
        vec2 dir = vUv - vec2(0.5);
        float d = length(dir);
        float offset = uIntensity * d;
        float flicker = 1.0 + 0.02 * sin(uTime * 30.0) * sin(uTime * 7.3);
        vec4 cr = texture2D(tDiffuse, vUv + dir * offset);
        vec4 cg = texture2D(tDiffuse, vUv);
        vec4 cb = texture2D(tDiffuse, vUv - dir * offset * 0.5);
        gl_FragColor = vec4(cr.r, cg.g * 1.05, cb.b * 0.6, 1.0) * flicker;
        gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * vec3(1.15, 0.85, 0.55), 0.3);
      }
    `,
  };
  return new ShaderPass(shader);
}
