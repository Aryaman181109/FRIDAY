import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

const simplexNoise = `
  vec3 mod289(vec3 x) {
    return x - floor(x * (1.0 / 289.0)) * 289.0;
  }

  vec4 mod289(vec4 x) {
    return x - floor(x * (1.0 / 289.0)) * 289.0;
  }

  vec4 permute(vec4 x) {
    return mod289(((x * 34.0) + 10.0) * x);
  }

  vec4 taylorInvSqrt(vec4 r) {
    return 1.79284291400159 - 0.85373472095314 * r;
  }

  float snoise(vec3 v) {
    const vec2 c = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 d = vec4(0.0, 0.5, 1.0, 2.0);

    vec3 i = floor(v + dot(v, c.yyy));
    vec3 x0 = v - i + dot(i, c.xxx);

    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);

    vec3 x1 = x0 - i1 + c.xxx;
    vec3 x2 = x0 - i2 + c.yyy;
    vec3 x3 = x0 - d.yyy;

    i = mod289(i);
    vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0))
      + i.x + vec4(0.0, i1.x, i2.x, 1.0));

    float n_ = 0.142857142857;
    vec3 ns = n_ * d.wyz - d.xzx;

    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);

    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);

    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);

    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));

    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);

    vec4 norm = taylorInvSqrt(vec4(
      dot(p0, p0),
      dot(p1, p1),
      dot(p2, p2),
      dot(p3, p3)
    ));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;

    vec4 m = max(0.6 - vec4(
      dot(x0, x0),
      dot(x1, x1),
      dot(x2, x2),
      dot(x3, x3)
    ), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(
      dot(p0, x0),
      dot(p1, x1),
      dot(p2, x2),
      dot(p3, x3)
    ));
  }

  float fbm(vec3 p) {
    float sum = 0.0;
    float amp = 0.52;
    float freq = 1.0;

    for (int i = 0; i < 5; i++) {
      sum += amp * snoise(p * freq);
      freq *= 2.03;
      amp *= 0.48;
      p += vec3(11.7, 4.6, 8.3);
    }

    return sum;
  }
`;

const vaporVertexShader = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const vaporFragmentShader = `
  uniform float uTime;
  uniform float uAudio;
  varying vec2 vUv;

  ${simplexNoise}

  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    p.x *= 1.05;

    float r = length(p);
    float angle = atan(p.y, p.x);
    float audioPulse = pow(clamp(uAudio, 0.0, 1.0), 0.72);
    float breath = sin(uTime * 0.52) * 0.026 + sin(uTime * 0.21) * 0.01 + audioPulse * 0.035;

    vec2 flow = vec2(
      fbm(vec3(p * 1.2 + vec2(3.1, 0.7), uTime * 0.055)),
      fbm(vec3(p * 1.4 + vec2(-1.2, 4.4), uTime * 0.05))
    );
    float slowSmoke = fbm(vec3(p * 1.7 + flow * 0.28, uTime * 0.065));
    float broadSmoke = fbm(vec3(p * 3.0 + vec2(slowSmoke, flow.x) * 0.36, uTime * 0.095));
    float fineSmoke = fbm(vec3(p * 8.6 + vec2(slowSmoke, broadSmoke) * 1.2, uTime * -0.13));
    float powderNoise = fbm(vec3(p * 15.0 + flow * 0.6, uTime * 0.11));

    float lopsided = sin(angle * 3.0 + slowSmoke * 2.8) * 0.026 +
      sin(angle * 7.0 - broadSmoke * 3.2) * 0.016;
    float radius = 0.54 + breath + lopsided + slowSmoke * 0.035 + broadSmoke * 0.024;
    float ringDistance = abs(r - radius);
    float outerFade = 1.0 - smoothstep(0.84, 1.2, r);
    float hollow = smoothstep(0.43 + breath * 0.12, 0.52 + broadSmoke * 0.022, r);
    float centerGuard = smoothstep(0.49, 0.55, r);

    float shellWide = 1.0 - smoothstep(0.07, 0.24, ringDistance);
    float shellCore = 1.0 - smoothstep(0.008, 0.062 + max(powderNoise, 0.0) * 0.03 + audioPulse * 0.018, ringDistance);
    float shellGlow = 1.0 - smoothstep(0.028, 0.15 + audioPulse * 0.035, ringDistance);

    float ribbonA = sin(angle * 4.6 + slowSmoke * 4.4 + uTime * 0.18) * 0.5 + 0.5;
    float ribbonB = sin(angle * 8.2 - broadSmoke * 4.0 - uTime * 0.13) * 0.5 + 0.5;
    float ribbonC = sin(angle * 13.0 + fineSmoke * 3.0 + uTime * 0.09) * 0.5 + 0.5;
    float filamentPattern = pow(smoothstep(0.48, 0.98, ribbonA * ribbonB + ribbonC * 0.32 + fineSmoke * 0.44), 2.3);
    float brokenShell = shellCore * smoothstep(0.38, 1.0, slowSmoke + broadSmoke * 0.72 + powderNoise * 0.34 + 0.36);
    float filaments = brokenShell * (0.38 + filamentPattern * 1.18);

    float topArc = smoothstep(-0.45, 0.92, sin(angle + 0.18));
    float rightArc = smoothstep(-0.5, 0.86, cos(angle - 0.2));
    float leftViolet = smoothstep(0.15, 0.95, -cos(angle + 0.28)) *
      smoothstep(-0.6, 0.78, -sin(angle - 0.18));

    float innerBand = smoothstep(0.5, 0.55, r) * (1.0 - smoothstep(0.61, 0.7, r));
    float innerSmoke = innerBand *
      smoothstep(-0.12, 0.78, broadSmoke + fineSmoke * 0.52 + flow.y * 0.18);
    float outerSmoke = (1.0 - smoothstep(0.5, 1.15, r)) *
      smoothstep(-0.04, 0.86, slowSmoke + broadSmoke * 0.76 + fineSmoke * 0.28);
    float feather = smoothstep(-0.28, 0.78, slowSmoke + powderNoise * 0.24);
    float smokeVeil = (outerSmoke * shellWide * (0.2 + feather * 0.14 + audioPulse * 0.12) + innerSmoke * 0.08) * outerFade;

    float silverArc = filaments * (0.58 + topArc * 0.34 + rightArc * 0.25);
    float violetArc = shellGlow * leftViolet * (0.12 + filamentPattern * 0.14);
    float darkCenter = 1.0 - smoothstep(0.18, 0.48, r);

    float alpha = smokeVeil * hollow;
    alpha += shellGlow * hollow * 0.06;
    alpha += silverArc * hollow * (0.38 + audioPulse * 0.22);
    alpha += violetArc * hollow * 0.015;
    alpha += innerSmoke * 0.04;
    alpha *= centerGuard;
    alpha *= outerFade;

    vec3 deepSmoke = vec3(0.08, 0.08, 0.08);
    vec3 blueSmoke = vec3(0.44, 0.44, 0.42);
    vec3 silver = vec3(0.96, 0.95, 0.9);
    vec3 violet = vec3(0.72, 0.7, 0.66);

    vec3 color = mix(deepSmoke, blueSmoke, smokeVeil + shellWide * 0.24);
    color = mix(color, silver, clamp(silverArc * 1.15, 0.0, 1.0));
    color = mix(color, violet, clamp(violetArc * 0.95, 0.0, 0.58));
    color += silver * silverArc * (0.66 + audioPulse * 0.36);
    color += violet * violetArc * 0.04;
    color *= 1.0 - darkCenter * 0.98;

    if (alpha < 0.003) {
      discard;
    }

    gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));
  }
`;

const particleVertexShader = `
  uniform float uTime;
  uniform float uAudio;
  attribute float aSeed;
  attribute float aSize;
  varying float vAlpha;

  ${simplexNoise}

  void main() {
    vec3 pos = position;
    float t = uTime * 0.07;
    float n = fbm(vec3(pos.xy * 2.45, aSeed + t));
    float breath = sin(uTime * 0.52 + aSeed * 6.28318) * 0.028;
    float audioPulse = pow(clamp(uAudio, 0.0, 1.0), 0.72);
    float drift = n * (0.2 + audioPulse * 0.22) + breath + audioPulse * 0.08;

    pos.xy += normalize(pos.xy + 0.0001) * drift;
    pos.x += snoise(vec3(pos.y * 2.8, aSeed, t)) * 0.06;
    pos.y += snoise(vec3(pos.x * 2.8, aSeed + 3.0, t)) * 0.06;
    pos.z += n * 0.12;

    float radial = length(pos.xy);
    float shell = smoothstep(0.48, 0.56, radial) * (1.0 - smoothstep(0.84, 1.02, radial));
    float sparks = smoothstep(0.68, 0.98, n + 0.4);
    vAlpha = shell * (0.2 + max(n, 0.0) * 0.58 + sparks * 0.34 + audioPulse * 0.42);

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = aSize * (230.0 + audioPulse * 150.0) / -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const particleFragmentShader = `
  varying float vAlpha;

  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float softDot = 1.0 - smoothstep(0.0, 1.0, dot(p, p));
    float alpha = softDot * softDot * vAlpha;

    if (alpha < 0.004) {
      discard;
    }

    gl_FragColor = vec4(vec3(0.92, 0.91, 0.86), alpha);
  }
`;

type OrbSceneProps = {
  audioLevel: number;
};

function VaporField({ audioLevel }: OrbSceneProps) {
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uAudio: { value: 0 },
    }),
    [],
  );

  useFrame(({ clock }) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = clock.elapsedTime;
      materialRef.current.uniforms.uAudio.value +=
        (audioLevel - materialRef.current.uniforms.uAudio.value) * 0.12;
    }
  });

  return (
    <mesh>
      <planeGeometry args={[3.15, 3.15, 1, 1]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={vaporVertexShader}
        fragmentShader={vaporFragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        depthTest={false}
        side={THREE.DoubleSide}
        toneMapped={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
}

function ParticleVeil({ audioLevel }: OrbSceneProps) {
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uAudio: { value: 0 },
    }),
    [],
  );

  const geometry = useMemo(() => {
    const count = 88;
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    const sizes = new Float32Array(count);

    for (let i = 0; i < count; i += 1) {
      const randomA = Math.sin(i * 12.9898) * 43758.5453;
      const randomB = Math.sin(i * 78.233) * 19341.7351;
      const randomC = Math.sin(i * 37.719) * 6173.4287;
      const angle = i * 2.399963229728653 + (randomA - Math.floor(randomA)) * 0.82;
      const band = 0.51 + (randomB - Math.floor(randomB)) * 0.31;
      const radius = band + ((randomC - Math.floor(randomC)) - 0.5) * 0.11;
      const index = i * 3;

      positions[index] = Math.cos(angle) * radius;
      positions[index + 1] = Math.sin(angle) * radius * 0.96;
      positions[index + 2] = (Math.sin(i * 37.719) - 0.5) * 0.34;
      seeds[i] = (Math.sin(i * 19.19) + 1) * 0.5;
      sizes[i] = 2.1 + ((i * 17) % 9);
    }

    const particleGeometry = new THREE.BufferGeometry();
    particleGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3),
    );
    particleGeometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    particleGeometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));

    return particleGeometry;
  }, []);

  useFrame(({ clock }) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = clock.elapsedTime;
      materialRef.current.uniforms.uAudio.value +=
        (audioLevel - materialRef.current.uniforms.uAudio.value) * 0.16;
    }
  });

  return (
    <points geometry={geometry}>
      <shaderMaterial
        ref={materialRef}
        vertexShader={particleVertexShader}
        fragmentShader={particleFragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        depthTest={false}
        toneMapped={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

export default function OrbScene({ audioLevel }: OrbSceneProps) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;

    const time = clock.elapsedTime;
    const breath =
      1 +
      Math.sin(time * 0.52) * 0.021 +
      Math.sin(time * 0.23) * 0.008 +
      audioLevel * 0.035;
    groupRef.current.scale.setScalar(breath);
  });

  return (
    <group ref={groupRef}>
      <VaporField audioLevel={audioLevel} />
      <ParticleVeil audioLevel={audioLevel} />
    </group>
  );
}
