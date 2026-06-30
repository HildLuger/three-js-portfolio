'use client';

// React and type imports
import * as React from 'react';
import type { CSSProperties } from 'react';
import { useRef, useEffect, useState, useCallback, Suspense, memo } from 'react';

// React Three Fiber - React renderer for Three.js (v9, React 19 compatible)
import { Canvas, useThree, useFrame, extend } from '@react-three/fiber';

// Drei - useful helpers and components for R3F
import { OrbitControls, Environment, useGLTF, Html, Preload } from '@react-three/drei';

// Bottom-left sun control overlay (controlled component)
import SunControl, { sunDirectionFromState } from './SunControl';

// WebGPU/TSL post-processing: bloom + lens flare. Owns the render loop,
// so it is only mounted on the WebGPU backend (not the WebGL2 fallback).
import PostFX from './PostFX';

// Three.js WebGPU build. This is the modern, high-performance renderer.
// Importing from 'three/webgpu' gives us WebGPURenderer + the node material system.
// WebGPURenderer automatically falls back to a WebGL2 backend when WebGPU is unavailable.
import * as THREE from 'three/webgpu';

// TSL (Three Shading Language) - the WebGPU-native way to author shaders.
// Used here for triplanar texturing that works without UV coordinates.
import {
  texture,
  vec3,
  uniform,
  positionWorld,
  positionView,
  normalWorld,
  normalView,
  mix,
  smoothstep,
  clamp,
  sin,
} from 'three/tsl';

// WebGPU/TSL node versions of the classic Sky + Water examples. The legacy
// three/addons/objects/Sky.js and Water.js are GLSL ShaderMaterials and do NOT
// run on WebGPURenderer; SkyMesh + WaterMesh are their node-based equivalents.
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { WaterMesh } from 'three/addons/objects/WaterMesh.js';

/**
 * Register every three/webgpu class with R3F's reconciler so that JSX scene
 * objects are constructed from the same module instance the WebGPURenderer uses.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
extend(THREE as any);

/**
 * Minimal TypeScript type for GLTF models loaded with useGLTF.
 * We only care about the 'scene' property which contains the 3D object.
 */
type GLTFLike = { scene: THREE.Object3D };

// A renderer can be either the WebGPU backend or its WebGL2 fallback; both share
// the properties we touch (toneMapping, exposure, etc.), so we use a loose type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRenderer = any;

/**
 * Enable Three.js caching system for better performance.
 * This caches loaded assets (textures, models) to avoid reloading them.
 */
THREE.Cache.enabled = true;

/**
 * ============================================================================
 * GLB MODEL LOADER COMPONENT
 * ============================================================================
 */
function GlbNode({ path, onReady }: { path: string; onReady?: () => void }) {
  const gltf = useGLTF(path) as unknown as GLTFLike;

  const node = React.useMemo(
    () => (gltf?.scene ?? new THREE.Group()) as THREE.Object3D,
    [gltf],
  );

  // Keep the latest callback in a ref so changing its identity on every parent
  // render does NOT retrigger the effect (which would cause an update loop).
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  React.useEffect(() => {
    onReadyRef.current?.();
  }, [gltf]);

  return <primitive object={node} />;
}

/**
 * ============================================================================
 * CONTEXT LOSS PROTECTION
 * ============================================================================
 * Handles graphics context loss/restore. On the WebGL2 fallback backend the
 * 'webglcontextlost' events fire; on the WebGPU backend device loss is handled
 * by the renderer itself, so these listeners are simply a safety net.
 */
function ContextLossProtector({ onLost, onRestored }: { onLost?: () => void; onRestored?: () => void }) {
  const { gl } = useThree();

  useEffect(() => {
    const renderer = gl as AnyRenderer;
    const c = renderer.domElement as HTMLCanvasElement;

    const handleLost = (e: Event) => {
      e.preventDefault();
      onLost?.();
    };

    const handleRestored = () => {
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      onRestored?.();
    };

    c.addEventListener('webglcontextlost', handleLost as EventListener, { passive: false });
    c.addEventListener('webglcontextrestored', handleRestored as EventListener);

    return () => {
      c.removeEventListener('webglcontextlost', handleLost as EventListener);
      c.removeEventListener('webglcontextrestored', handleRestored as EventListener);
    };
  }, [gl, onLost, onRestored]);

  return null;
}

/**
 * ============================================================================
 * RENDERER & SCENE SETTINGS COMPONENTS
 * ============================================================================
 */

/** Controls overall scene brightness via tone mapping exposure. */
const Exposure = memo(function Exposure({ value = 0.62 }: { value: number }) {
  const { gl } = useThree();

  useEffect(() => {
    const renderer = gl as AnyRenderer;
    const prev = renderer.toneMappingExposure;
    renderer.toneMappingExposure = value;
    return () => {
      renderer.toneMappingExposure = prev;
    };
  }, [gl, value]);

  return null;
});

type SceneWithEnvIntensity = THREE.Scene & { environmentIntensity?: number };

/** Controls the intensity of environment-map reflections on materials. */
const SceneEnvIntensity = memo(function SceneEnvIntensity({ value = 0.6 }: { value?: number }) {
  const { scene } = useThree();

  useEffect(() => {
    const s = scene as SceneWithEnvIntensity;
    const prev = s.environmentIntensity;
    s.environmentIntensity = value;
    return () => {
      s.environmentIntensity = prev ?? 1;
    };
  }, [scene, value]);

  return null;
});

type SceneWithBg = THREE.Scene & { backgroundIntensity?: number; backgroundBlurriness?: number };

/** Controls the intensity and blur of the environment background. */
const BackgroundTune = memo(function BackgroundTune({ intensity = 1, blur = 0.8 }: { intensity?: number; blur?: number }) {
  const { scene } = useThree();

  useEffect(() => {
    const s = scene as SceneWithBg;
    const pi = s.backgroundIntensity;
    const pb = s.backgroundBlurriness;
    s.backgroundIntensity = intensity;
    s.backgroundBlurriness = blur;
    return () => {
      s.backgroundIntensity = pi ?? 1;
      s.backgroundBlurriness = pb ?? 0;
    };
  }, [scene, intensity, blur]);

  return null;
});

/**
 * OrbitControls wrapper.
 *
 * Auto-rotation needs a continuous render loop, which is provided by the
 * Canvas `frameloop="always"` (gated by viewport visibility in the parent).
 * drei's OrbitControls updates damping/auto-rotate inside its own useFrame,
 * so no manual requestAnimationFrame/invalidate loop is required here.
 */
const SmartOrbitControls = memo(function SmartOrbitControls() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth < 768);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  return (
    <OrbitControls
      enableDamping
      dampingFactor={0.1}
      enablePan={false}
      enableZoom={isMobile}
      minDistance={isMobile ? 4 : undefined}
      maxDistance={isMobile ? 10 : undefined}
      autoRotate
      autoRotateSpeed={1}
      target={[0, 0, 0]}
      minAzimuthAngle={-Infinity}
      maxAzimuthAngle={Infinity}
      minPolarAngle={0}
      maxPolarAngle={Math.PI / 2 - 0.001}
      makeDefault
    />
  );
});

/**
 * ============================================================================
 * MESH & MATERIAL CATALOGS
 * ============================================================================
 */
const MESHES = [
  { name: 'Mother Earth', glb: '/glb1.glb' },
  { name: 'Venus Willendorf', glb: '/glb2.glb' },
  { name: 'Hekate Trivia', glb: '/glb3.glb' },
  { name: 'Transi de Rene de Chalon', glb: '/glb4.glb' },
  { name: 'Skull', glb: '/glb5.glb' },
  { name: 'Sphere' },
  { name: 'Box' },
  { name: 'Torus' },
  { name: 'Cone' },
  { name: 'Cylinder' },
];

// Shared clay normal map (4K). Spaces in the filename are URL-encoded so the
// browser fetch resolves. Used by both clay materials (gray + brown).
const CLAY_NRM = '/clay/Clay%20base%20broad%20strokes_4K_NRM.jpg';

// >>> Clay bump (normal) strength — TUNE THIS. Single source of truth for BOTH
// the "Clay" (brown) and "Clay Gray" materials. Higher = deeper relief.
// (was 0.7 which read too strong; lower it further toward 0 to soften.)
const CLAY_BUMP = 0.025;

const MATERIALS = [
  // Textured materials (with image maps)
  { name: 'Texture 1', base: { metalness: 0.0, roughness: 0.1, ior: 1.5, transmission: 0, thickness: 0, clearcoat: 1, clearcoatRoughness: 0.2 }, mapUrl: '/texture1.jpg' },
  { name: 'Texture 2', base: { metalness: 0.2, roughness: 0.3, ior: 1.5, transmission: 0, thickness: 0, clearcoat: 0, clearcoatRoughness: 0 }, mapUrl: '/texture2.jpg' },
  { name: 'Texture 3', base: { metalness: 0.0, roughness: 0.1, ior: 1.5, transmission: 0, thickness: 0, clearcoat: 1, clearcoatRoughness: 0.2 }, mapUrl: '/texture3.jpg' },
  { name: 'Texture 4', base: { metalness: 0.6, roughness: 0.1, ior: 1.5, transmission: 0, thickness: 0, clearcoat: 1, clearcoatRoughness: 0.3 }, mapUrl: '/texture4.jpg' },
  { name: 'Texture 5', base: { metalness: 0.0, roughness: 0.1, ior: 1.5, transmission: 0, thickness: 0, clearcoat: 1, clearcoatRoughness: 0 }, mapUrl: '/texture5.jpg' },
  { name: 'Texture 6', base: { metalness: 0.0, roughness: 0.1, ior: 1.5, transmission: 0, thickness: 0, clearcoat: 1, clearcoatRoughness: 0 }, mapUrl: '/texture6.jpg' },
  { name: 'Texture 7', base: { metalness: 0.0, roughness: 0.1, ior: 1.5, transmission: 0, thickness: 0, clearcoat: 0, clearcoatRoughness: 0 }, mapUrl: '/texture7.jpg' },
  { name: 'Texture 8', base: { metalness: 0.0, roughness: 0.1, ior: 1.5, transmission: 0, thickness: 0, clearcoat: 1, clearcoatRoughness: 0 }, mapUrl: '/texture8.jpg' },
  { name: 'Texture 9', base: { metalness: 0.0, roughness: 0.1, ior: 1.5, transmission: 0, thickness: 0, clearcoat: 1, clearcoatRoughness: 0 }, mapUrl: '/texture9.jpg' },

  // Solid color materials. The pastel nature swatches share the Default
  // material's glossy ceramic finish (roughness 0.1 + clearcoat) on a
  // low-saturation natural palette (purple, wine, dark green, sage, dusty blue,
  // blush). The two clay materials instead use a matte finish with the shared
  // clay normal map for surface relief.
  { name: 'Default', base: { color: '#8976b8', metalness: 0, roughness: 0.1, ior: 1.5, transmission: 0, thickness: 0, clearcoat: 1, clearcoatRoughness: 0.2 } },
  { name: 'Lavender', base: { color: '#b1a3cf', metalness: 0, roughness: 0.1, ior: 1.5, transmission: 0, thickness: 0, clearcoat: 1, clearcoatRoughness: 0.2 } },
  { name: 'Wine', base: { color: '#96687a', metalness: 0, roughness: 0.1, ior: 1.5, transmission: 0, thickness: 0, clearcoat: 1, clearcoatRoughness: 0.2 } },
  { name: 'Forest', base: { color: '#5f7a63', metalness: 0, roughness: 0.1, ior: 1.5, transmission: 0, thickness: 0, clearcoat: 1, clearcoatRoughness: 0.2 } },
  { name: 'Sage', base: { color: '#9fb39a', metalness: 0, roughness: 0.1, ior: 1.5, transmission: 0, thickness: 0, clearcoat: 1, clearcoatRoughness: 0.2 } },
  { name: 'Mist', base: { color: '#9bb2c4', metalness: 0, roughness: 0.1, ior: 1.5, transmission: 0, thickness: 0, clearcoat: 1, clearcoatRoughness: 0.2 } },
  { name: 'Blush', base: { color: '#c19a8c', metalness: 0, roughness: 0.1, ior: 1.5, transmission: 0, thickness: 0, clearcoat: 1, clearcoatRoughness: 0.2 } },
  // The two clay materials sit next to each other in the grid and share the
  // clay normal map. Their bump strength comes from the CLAY_BUMP constant above.
  { name: 'Clay', base: { color: '#c8b79e', metalness: 0, roughness: 0.4, ior: 1.5, transmission: 0, thickness: 0, clearcoat: 0, clearcoatRoughness: 0 }, normalUrl: CLAY_NRM, bump: CLAY_BUMP },
  { name: 'Clay Gray', base: { color: '#666666', metalness: 0, roughness: 0.4, ior: 1.5, transmission: 0, thickness: 0, clearcoat: 0, clearcoatRoughness: 0 }, normalUrl: CLAY_NRM, bump: CLAY_BUMP },
  { name: 'Glass', base: { color: '#ffffff', metalness: 0, roughness: 0.1, ior: 1.5, transmission: 1, thickness: 1, clearcoat: 0, clearcoatRoughness: 0 }, thumb: 'radial-gradient(circle at 32% 28%, rgba(255,255,255,0.95), rgba(186,214,232,0.55) 55%, rgba(120,150,180,0.7))' },
  { name: 'Chrome', base: { color: '#ffffff', metalness: 1, roughness: 0.1, ior: 1.5, transmission: 0, thickness: 0, clearcoat: 0, clearcoatRoughness: 0 }, thumb: 'linear-gradient(135deg, #eceef2 0%, #b9bdc6 22%, #f6f7f9 48%, #9aa1aa 72%, #d9dce1 100%)' },
];

// Module-level texture cache shared across the app. Each URL is loaded once and
// the resulting THREE.Texture is reused, so switching back to a material is
// instant and — crucially — the liquid morph blends into a texture that is
// already resident instead of a stale one that finishes loading after the
// animation ends. `getCachedTexture` resolves synchronously from cache when the
// texture is already present.
const _texCache = new Map<string, THREE.Texture>();

function getCachedTexture(url: string, isNormal: boolean): Promise<THREE.Texture> {
  const cached = _texCache.get(url);
  if (cached) return Promise.resolve(cached);
  return new Promise<THREE.Texture>((resolve, reject) => {
    new THREE.TextureLoader().load(
      url,
      (t) => {
        // Normal maps are data (linear); albedo maps are color (sRGB).
        t.colorSpace = isNormal ? THREE.NoColorSpace : THREE.SRGBColorSpace;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        t.magFilter = THREE.LinearFilter;
        t.anisotropy = isNormal ? 8 : 16;
        t.needsUpdate = true;
        _texCache.set(url, t);
        resolve(t);
      },
      undefined,
      reject,
    );
  });
}

// Live triplanar sampler. The stock three `triplanarTexture` helper reads
// `node.value` once at graph-build time and bakes that exact texture object
// into the shader, so swapping our morph node's `.value` afterwards has no
// effect (every material would keep showing whatever was bound at first
// compile). Instead we sample our PERSISTENT TextureNode three times via
// `.sample(uv)` — each clone keeps a live reference to the base node, so
// updating `texNode.value` re-binds all three samples. Returns a vec4.
function triplanarLive(texNode: TSLNode, scale: TSLNode, posNode: TSLNode, normalNode: TSLNode): TSLNode {
  const bfRaw: TSLNode = normalNode.abs().normalize();
  const bf: TSLNode = bfRaw.div(bfRaw.dot(vec3(1.0)));
  const tx: TSLNode = posNode.yz.mul(scale);
  const ty: TSLNode = posNode.zx.mul(scale);
  const tz: TSLNode = posNode.xy.mul(scale);
  const cx: TSLNode = texNode.sample(tx).mul(bf.x);
  const cy: TSLNode = texNode.sample(ty).mul(bf.y);
  const cz: TSLNode = texNode.sample(tz).mul(bf.z);
  return cx.add(cy).add(cz);
}

// A loosely-typed TSL node (uniform / expression). The node graph is built once;
// we only mutate `.value` on the uniforms at runtime.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TSLNode = any;

// 1×1 white pixel used as the initial texture for the from/to texture nodes,
// before any real material texture has loaded. Shared across all instances.
const WHITE_PIXEL = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
WHITE_PIXEL.colorSpace = THREE.SRGBColorSpace;
WHITE_PIXEL.needsUpdate = true;

// The subset of MeshPhysical scalar params that the liquid transition does NOT
// blend in the node graph (transmission/clearcoat/ior). They are snapped at the
// midpoint of the morph instead. Color, roughness and metalness ARE node-blended.
type MaterialScalars = {
  transmission: number;
  thickness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  ior: number;
};

function computeScalars(
  params: THREE.MeshPhysicalMaterialParameters & { color?: string },
): MaterialScalars {
  const EPS = 0.02;
  return {
    transmission: (params.transmission ?? 0) > EPS ? (params.transmission as number) : 0,
    thickness: (params.thickness ?? 0) > EPS ? (params.thickness as number) : 0,
    clearcoat: (params.clearcoat ?? 0) > EPS ? (params.clearcoat as number) : 0,
    clearcoatRoughness: params.clearcoatRoughness ?? 0,
    ior: params.ior ?? 1.5,
  };
}

function applyScalars(m: THREE.MeshPhysicalNodeMaterial, s: MaterialScalars) {
  m.transmission = s.transmission;
  m.thickness = s.thickness;
  m.clearcoat = s.clearcoat;
  m.clearcoatRoughness = s.clearcoatRoughness;
  m.ior = s.ior;
}

// Smooth ease for the liquid sweep so it accelerates then settles.
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Duration of the material liquid transition, in seconds.
const MORPH_DURATION = 0.9;

// ============================================================================
// SCENE TUNABLES — edit these to position the sun + ocean
// ============================================================================
// Ocean surface height (world Y). Tweak this single value to find the right
// waterline relative to the model; the SkyOcean call below uses it.
const OCEAN_Y = -1.5;

// Tone-mapping exposure. Kept low to match the analytic sky/ocean reference;
// note it dims EVERYTHING, including the HDR ambient (raise ENV_INTENSITY to
// compensate rather than this, unless you want the sky/ocean brighter too).
const SCENE_EXPOSURE = 0.6;

// Sunset-HDR ambient + reflection brightness on the model. Because exposure is
// low, this is boosted so the HDR lighting/reflections read well. Raise it if
// the model still looks too dark, lower it if reflections blow out (try 0.6–4).
const ENV_INTENSITY = 0.6;

// Sun control's DEFAULT knob position — the single source of truth that drives
// BOTH the UI knob and the scene sun, so they always agree. dayAngle is 0..180
// along the arc (0 = right/sunset horizon, 90 = noon apex, 180 = left/dawn
// horizon). 45 ≈ 3:00 pm on the afternoon side; scene elevation is DERIVED.
const DEFAULT_DAY_ANGLE = 15; // 5:00 pm on the afternoon arc
const DEFAULT_SUN_AZIMUTH = 0; // rotation slider fully to the left

/**
 * ============================================================================
 * SKY + OCEAN (WebGPU)
 * ============================================================================
 * Analytic daytime sky (SkyMesh, with volumetric clouds) plus a flat, reflective
 * ocean (WaterMesh, which uses a planar reflector). Replaces the old floor disc.
 *
 * The model's ambient lighting + reflections come from the sunset HDR
 * environment (see the <Environment> in ThreeCanvas); the ocean reflects the
 * analytic sky via its own planar reflector. Both meshes rely on the
 * auto-advancing TSL `time` node, so the water animates automatically every
 * rendered frame — no manual per-frame uniform updates.
 *
 * The meshes are built once and the sun direction is updated imperatively when
 * the sun control changes, so dragging the sun is cheap (uniform writes only).
 */
function SkyOcean({
  sunDirection,
  oceanY = -0.0,
  exposure = 0.1,
}: {
  sunDirection: [number, number, number];
  oceanY?: number;
  exposure?: number;
}) {
  const { scene, gl, invalidate } = useThree();
  const skyRef = useRef<SkyMesh | null>(null);
  const waterRef = useRef<WaterMesh | null>(null);

  // Build the sky + ocean once.
  useEffect(() => {
    const sky = new SkyMesh();
    sky.scale.setScalar(10000);
    sky.turbidity.value = 10;
    sky.rayleigh.value = 2;
    sky.mieCoefficient.value = 0.005;
    sky.mieDirectionalG.value = 0.8;
    sky.cloudCoverage.value = 0.4;
    sky.cloudDensity.value = 0.5;
    sky.cloudElevation.value = 0.5;
    scene.add(sky);
    skyRef.current = sky;

    const waterNormals = new THREE.TextureLoader().load('/waternormals.jpg', (t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
    });
    const water = new WaterMesh(new THREE.PlaneGeometry(10000, 10000), {
      waterNormals,
      sunColor: 0xffffff,
      waterColor: 0x001e0f,
      distortionScale: 3.7,
      size: 1,
    });
    water.rotation.x = -Math.PI / 2;
    water.position.y = oceanY;
    scene.add(water);
    waterRef.current = water;

    invalidate();

    return () => {
      scene.remove(sky);
      scene.remove(water);
      (sky.material as THREE.Material).dispose();
      (water.material as THREE.Material).dispose();
      sky.geometry.dispose();
      water.geometry.dispose();
      waterNormals.dispose();
      skyRef.current = null;
      waterRef.current = null;
    };
  }, [scene, oceanY, invalidate]);

  // Keep tone-mapping exposure in sync.
  useEffect(() => {
    (gl as AnyRenderer).toneMappingExposure = exposure;
    invalidate();
  }, [gl, exposure, invalidate]);

  // Update the sun direction (shared by sky scattering + ocean specular) when
  // the sun control changes — cheap uniform writes, no mesh re-creation.
  //
  // The analytic SkyMesh (Preetham daytime model) collapses to near-black when
  // the sun sits exactly on the horizon (y = 0), so dawn/dusk looked dead. Two
  // fixes here, both driven by the sun's elevation factor (the unit dir's y):
  //   1. Pin the sun fractionally above the horizon so the sky keeps rendering
  //      its rich orange/red scattering band instead of going black.
  //   2. Blend the scattering + cloud + exposure uniforms toward a warm sunset
  //      look as the sun approaches the horizon.
  useEffect(() => {
    const sky = skyRef.current;
    const water = waterRef.current;
    if (!sky || !water) return;
    const [sx, sy, sz] = sunDirection;

    // sy is the elevation factor (0 = horizon, 1 = zenith) since sunDirection
    // is a unit vector. "horizon" is 1 at/below the horizon and fades to 0 once
    // the sun climbs past ~18° (sin 18° ≈ 0.31) — the twilight/golden-hour band.
    const horizon = THREE.MathUtils.clamp(1 - sy / 0.31, 0, 1);

    // Keep the sun just above the horizon so the orange band never disappears.
    const skyY = Math.max(sy, 0.05);
    sky.sunPosition.value.set(sx, skyY, sz);
    water.sunDirection.value.set(sx, skyY, sz).normalize();

    // Warm, hazier, denser-scattering sky near the horizon for a redder sunset;
    // calmer daytime values up high.
    sky.turbidity.value = THREE.MathUtils.lerp(10, 14, horizon);
    sky.rayleigh.value = THREE.MathUtils.lerp(2, 4, horizon);
    sky.mieCoefficient.value = THREE.MathUtils.lerp(0.005, 0.009, horizon);
    sky.mieDirectionalG.value = THREE.MathUtils.lerp(0.8, 0.93, horizon);
    // Thin the clouds at low sun so they don't read as black blotches.
    sky.cloudCoverage.value = THREE.MathUtils.lerp(0.4, 0.3, horizon);
    sky.cloudDensity.value = THREE.MathUtils.lerp(0.5, 0.22, horizon);

    // Lift exposure as the sky dims toward dusk so it stays luminous, not murky.
    (gl as AnyRenderer).toneMappingExposure = THREE.MathUtils.lerp(
      exposure,
      exposure * 1.7,
      horizon,
    );

    invalidate();
  }, [sunDirection, exposure, gl, invalidate]);

  return null;
}

/**
 * Directional "sun" light that follows the same sun direction as the sky/ocean,
 * so the model's key light + shadow track the SunControl. Updated imperatively
 * (via ref) so dragging the sun never re-renders the memoized Scene.
 */
function SunLight({
  sunDirection,
  safeMode,
  distance = 12,
  intensity = 1.0,
}: {
  sunDirection: [number, number, number];
  safeMode: boolean;
  distance?: number;
  intensity?: number;
}) {
  const lightRef = useRef<THREE.DirectionalLight>(null);
  const { invalidate } = useThree();

  useEffect(() => {
    const l = lightRef.current;
    if (!l) return;
    const [sx, sy, sz] = sunDirection;
    // Keep the light above the horizon so the model never goes fully dark.
    l.position.set(sx * distance, Math.max(0.15, sy) * distance, sz * distance);
    invalidate();
  }, [sunDirection, distance, invalidate]);

  return (
    <directionalLight
      ref={lightRef}
      intensity={intensity}
      castShadow={!safeMode}
      shadow-mapSize-width={safeMode ? 512 : 1024}
      shadow-mapSize-height={safeMode ? 512 : 1024}
      shadow-camera-far={20}
      shadow-camera-left={-10}
      shadow-camera-right={10}
      shadow-camera-top={10}
      shadow-camera-bottom={-10}
      shadow-bias={-0.0001}
    />
  );
}

/**
 * ============================================================================
 * SHADER COMPILER (loading gate)
 * ============================================================================
 * Precompiles the current scene's WebGPU render pipelines BEFORE the loading
 * overlay is lifted, so the very first visible frame is already smooth and the
 * user never sees a shader-compile hitch. `active` is flipped on only once the
 * assets are downloaded and the initial mesh/material are actually mounted, so
 * compileAsync sees the real material graph. Runs once per context.
 */
function ShaderCompiler({ active, onCompiled }: { active: boolean; onCompiled: () => void }) {
  const { gl, scene, camera } = useThree();
  const doneRef = useRef(false);

  useEffect(() => {
    if (!active || doneRef.current) return;
    doneRef.current = true;
    let cancelled = false;

    (async () => {
      const renderer = gl as AnyRenderer;
      try {
        if (typeof renderer.compileAsync === 'function') {
          await renderer.compileAsync(scene, camera);
        }
      } catch {
        // Compilation is best-effort; reveal regardless so we never hard-block.
      }
      // One more frame to ensure pipelines for the sky/ocean/postFX are warm.
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      if (!cancelled) onCompiled();
    })();

    return () => {
      cancelled = true;
    };
  }, [active, gl, scene, camera, onCompiled]);

  return null;
}

/**
 * ============================================================================
 * SCENE COMPONENT
 * ============================================================================
 */
const Scene = memo(function Scene({
  meshIndex,
  matIndex,
  params,
  envIntensity,
  safeMode,
  mapUrl,
  triScale,
  ctxVersion,
  onReady,
}: {
  meshIndex: number;
  matIndex: number;
  params: THREE.MeshPhysicalMaterialParameters & { color?: string };
  envIntensity: number;
  safeMode: boolean;
  mapUrl?: string;
  triScale: number;
  ctxVersion: number;
  onReady?: () => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const groupRef = useRef<THREE.Group>(null!);
  const readyNotifiedRef = useRef(false);
  const { invalidate } = useThree();

  // ticks when a GLB actually mounts so we can re-assign materials then
  const [glbMountTick, setGlbMountTick] = useState(0);

  /* -------- GLB selection -------- */
  const meshDef = MESHES[meshIndex] as { name: string; glb?: string };
  const isGLB = typeof meshDef?.glb === 'string';
  const glbPath = isGLB ? (meshDef.glb as string) : '';

  // Track which GLB path has finished mounting. Deriving the loading flag from
  // this (instead of toggling state in effects) avoids a child/parent effect
  // ordering race that left "Loading model..." stuck on screen forever.
  const [loadedPath, setLoadedPath] = useState<string | null>(null);
  const loadingGlb = isGLB && loadedPath !== glbPath;

  // Stable callback fired once the GLB scene graph is mounted.
  const handleGlbReady = useCallback(() => {
    setGlbMountTick((t) => t + 1);
    setLoadedPath(glbPath);
  }, [glbPath]);

  /* -------- Preload every material texture once (warms the cache so the
     liquid morph always blends into a texture that is already resident). -------- */
  useEffect(() => {
    for (const m of MATERIALS) {
      const mm = m as { mapUrl?: string; normalUrl?: string };
      if (mm.mapUrl) getCachedTexture(mm.mapUrl, false).catch(() => {});
      if (mm.normalUrl) getCachedTexture(mm.normalUrl, true).catch(() => {});
    }
  }, []);

  /* -------- Spinner state for the current material's albedo texture. -------- */
  // The actual textures used by the morph are resolved directly from the cache
  // inside the transition effect below (not from React state) so there is no
  // lag/race between a switch and which texture the morph reveals. This effect
  // only drives the "Loading texture..." indicator + the ready notification.
  const [loadingTex, setLoadingTex] = useState(false);

  useEffect(() => {
    if (!mapUrl || _texCache.get(mapUrl)) {
      setLoadingTex(false);
      return;
    }
    let alive = true;
    setLoadingTex(true);
    getCachedTexture(mapUrl, false)
      .then(() => {
        if (alive) setLoadingTex(false);
      })
      .catch(() => {
        if (alive) setLoadingTex(false);
      });
    return () => {
      alive = false;
    };
  }, [mapUrl]);

  // Notify parent when scene is ready (model loaded, no texture loading)
  useEffect(() => {
    if (!loadingGlb && !loadingTex && !readyNotifiedRef.current) {
      readyNotifiedRef.current = true;
      onReady?.();
    }
  }, [loadingGlb, loadingTex, onReady]);

  /* -------- Shared WebGPU node material + liquid-transition graph -------- */
  // The material's appearance is a node graph built ONCE that blends a "from"
  // and a "to" appearance through an animated "liquid" mask. Switching material
  // snapshots the current look into "from", sets the new look as "to", and
  // animates `progress` 0→1 so the new material floods over the old one with a
  // wavy front. Slider tweaks update "to" (and, while idle, mirror it into
  // "from") so they apply instantly without a transition. Nothing here rebuilds
  // the shader — we only mutate uniform `.value`s — so it stays cheap.
  const sharedMatRef = useRef<THREE.MeshPhysicalNodeMaterial | null>(null);
  const nodesRef = useRef<{
    triScale: TSLNode;
    pivot: TSLNode;
    invSpanY: TSLNode;
    progress: TSLNode;
    fromColor: TSLNode;
    toColor: TSLNode;
    fromIsTex: TSLNode;
    toIsTex: TSLNode;
    fromRough: TSLNode;
    toRough: TSLNode;
    fromMetal: TSLNode;
    toMetal: TSLNode;
    fromTex: TSLNode;
    toTex: TSLNode;
    normalTex: TSLNode;
    bump: TSLNode;
  } | null>(null);
  const morphRef = useRef<{
    active: boolean;
    // True from the instant a switch is requested until its morph actually
    // starts. On a cold cache the morph waits for the destination texture to
    // load, and during that gap the slider/scalar effect must NOT mirror or
    // re-apply anything (it would corrupt the captured "from" snapshot).
    pending: boolean;
    t: number;
    scalarsApplied: boolean;
    targetScalars: MaterialScalars;
  }>({ active: false, pending: false, t: 0, scalarsApplied: true, targetScalars: computeScalars(params) });
  const firstMatRunRef = useRef(true);
  // Monotonic token so an async texture load from a superseded switch can't
  // clobber the current target (rapid clicking through swatches).
  const switchTokenRef = useRef(0);

  if (!nodesRef.current) {
    const initColor = (params.color as string) || '#ffffff';
    const initIsTex = mapUrl ? 1 : 0;
    nodesRef.current = {
      triScale: uniform(triScale),
      pivot: uniform(new THREE.Vector3()),
      invSpanY: uniform(1),
      progress: uniform(0),
      fromColor: uniform(new THREE.Color(initColor)),
      toColor: uniform(new THREE.Color(initColor)),
      fromIsTex: uniform(initIsTex),
      toIsTex: uniform(initIsTex),
      fromRough: uniform(params.roughness ?? 0.5),
      toRough: uniform(params.roughness ?? 0.5),
      fromMetal: uniform(params.metalness ?? 0),
      toMetal: uniform(params.metalness ?? 0),
      fromTex: texture(WHITE_PIXEL),
      toTex: texture(WHITE_PIXEL),
      normalTex: texture(WHITE_PIXEL),
      bump: uniform(0),
    };
  }

  if (!sharedMatRef.current) {
    const n = nodesRef.current;
    const m = new THREE.MeshPhysicalNodeMaterial();
    m.envMapIntensity = envIntensity;

    // Triplanar projection from world position (relative to the object's center)
    // so textures map cleanly onto any geometry, even UV-less models. The graph
    // locals are typed loosely (TSLNode) because the strict three/tsl overloads
    // don't track our `any`-typed uniforms through the arithmetic below.
    const pos = positionWorld as TSLNode;
    const projPos: TSLNode = pos.sub(n.pivot);
    const fromTexSample: TSLNode = triplanarLive(n.fromTex, n.triScale, projPos, normalWorld);
    const toTexSample: TSLNode = triplanarLive(n.toTex, n.triScale, projPos, normalWorld);
    // Each side is either a solid color or its triplanar texture, chosen by the
    // isTex uniform (0 = color, 1 = texture) — no recompile when it changes.
    const fromApp: TSLNode = mix(n.fromColor, fromTexSample.rgb, n.fromIsTex);
    const toApp: TSLNode = mix(n.toColor, toTexSample.rgb, n.toIsTex);

    // Liquid mask: a wavy front floods top→bottom as progress goes 0→1. `h` is
    // the object-normalised height [0..1]; using (1 - h) makes the new material
    // appear at the top first and run down. Two sine waves wobble the front so
    // it reads like a liquid surface rather than a straight wipe.
    const local: TSLNode = pos.sub(n.pivot);
    const h: TSLNode = clamp(local.y.mul(n.invSpanY).add(0.5), 0, 1);
    const wobble: TSLNode = sin(local.x.mul(7.0).add(n.progress.mul(6.2)))
      .add(sin(local.z.mul(5.0).add(n.progress.mul(4.5))))
      .mul(0.06);
    const coord: TSLNode = h.oneMinus().add(wobble);
    const front: TSLNode = n.progress.mul(1.52).sub(0.26);
    // mask = 1 below the front (new material), 0 above (old material).
    const mask: TSLNode = smoothstep(front.sub(0.12), front.add(0.12), coord).oneMinus();

    m.colorNode = mix(fromApp, toApp, mask);
    m.roughnessNode = mix(n.fromRough, n.toRough, mask);
    m.metalnessNode = mix(n.fromMetal, n.toMetal, mask);

    // Triplanar bump (normal) mapping for the clay materials. Because the meshes
    // have no UVs or tangents, we can't use the standard tangent-space normalMap
    // node; instead we perturb the view normal from screen-space derivatives of
    // a triplanar-sampled height (Mikkelsen's unparametrized-surface method, the
    // same approach three's bumpMap uses). The clay normal map's green channel is
    // used as the height signal. When `bump` is 0 (all non-clay materials) the
    // gradient vanishes and this returns the unperturbed geometric normal.
    const heightSample: TSLNode = triplanarLive(n.normalTex, n.triScale, projPos, normalWorld);
    const height: TSLNode = heightSample.g;
    const dHx: TSLNode = height.dFdx().mul(n.bump);
    const dHy: TSLNode = height.dFdy().mul(n.bump);
    const sigX: TSLNode = positionView.dFdx();
    const sigY: TSLNode = positionView.dFdy();
    const vN: TSLNode = normalView;
    const R1: TSLNode = sigY.cross(vN);
    const R2: TSLNode = vN.cross(sigX);
    const fDet: TSLNode = sigX.dot(R1);
    const vGrad: TSLNode = R1.mul(dHx).add(R2.mul(dHy)).mul(fDet.sign());
    m.normalNode = vN.mul(fDet.abs()).sub(vGrad).normalize();

    sharedMatRef.current = m;
    applyScalars(m, computeScalars(params));
  }

  /* -------- Trigger a liquid transition on material switch -------- */
  // The morph endpoints are resolved DETERMINISTICALLY from the selected
  // material definition + the texture cache here — never from the lagging
  // `params`/`tex` React state — so the texture the morph reveals is always the
  // one for the swatch that was clicked, with no mid/post-transition flips.
  //
  // CRITICAL for consistency: the destination texture(s) are made resident
  // BEFORE the flood starts. When they are already cached (the common case
  // after preload) we begin synchronously, so warm switches are instant. When
  // the cache is still cold (e.g. on a slow connection right after load) we
  // wait for the texture to arrive and only THEN start the morph. This is what
  // prevents the old "flood reveals the wrong/placeholder texture, then snaps
  // to the real one with no transition" behaviour seen in production.
  useEffect(() => {
    const n = nodesRef.current;
    const m = sharedMatRef.current;
    if (!n || !m) return;

    const mat = MATERIALS[matIndex] as {
      base: THREE.MeshPhysicalMaterialParameters & { color?: string };
      mapUrl?: string;
      normalUrl?: string;
      bump?: number;
    };
    const base = mat.base;
    const bumpStrength = mat.bump ?? 0;
    const token = ++switchTokenRef.current;
    const first = firstMatRunRef.current;

    // Snapshot the currently displayed look into "from" SYNCHRONOUSLY (skipped
    // on the very first run, where there is nothing to transition from). Doing
    // this now — before any await — captures the genuine outgoing appearance and
    // protects it from the slider/scalar effect, which runs when `params`
    // updates on this same switch. `pending` keeps that effect hands-off until
    // the morph actually starts.
    morphRef.current.pending = true;
    if (!first) {
      n.fromColor.value.copy(n.toColor.value);
      n.fromRough.value = n.toRough.value;
      n.fromMetal.value = n.toMetal.value;
      n.fromIsTex.value = n.toIsTex.value;
      n.fromTex.value = n.toTex.value;
    }

    // Starts (or, on the very first run, instantly applies) the transition once
    // every destination texture this material needs is resident. `albedoTex` /
    // `normalTex` are null when the material has no such map.
    const begin = (albedoTex: THREE.Texture | null, normalTex: THREE.Texture | null) => {
      // A newer switch superseded this one while we were loading — drop it.
      if (switchTokenRef.current !== token) return;

      // Resolve the NEW material's "to" appearance from its definition.
      if (base.color) n.toColor.value.set(base.color as string);
      n.toRough.value = base.roughness ?? 0.5;
      n.toMetal.value = base.metalness ?? 0;

      if (albedoTex) {
        n.toTex.value = albedoTex;
        n.toIsTex.value = 1;
      } else {
        n.toIsTex.value = 0;
      }

      // Normal/bump (surface detail, not blended through the mask).
      if (normalTex) {
        n.normalTex.value = normalTex;
        n.bump.value = bumpStrength;
      } else {
        n.bump.value = 0;
      }

      morphRef.current.targetScalars = computeScalars(base);

      if (first) {
        // First mount: no animation — mirror "to" into "from", apply scalars now.
        firstMatRunRef.current = false;
        n.fromColor.value.copy(n.toColor.value);
        n.fromRough.value = n.toRough.value;
        n.fromMetal.value = n.toMetal.value;
        n.fromIsTex.value = n.toIsTex.value;
        n.fromTex.value = n.toTex.value;
        applyScalars(m, morphRef.current.targetScalars);
      } else {
        morphRef.current.active = true;
        morphRef.current.t = 0;
        morphRef.current.scalarsApplied = false;
        n.progress.value = 0;
      }
      morphRef.current.pending = false;
      invalidate();
    };

    // Fast path: every required texture is already cached → begin synchronously
    // this same tick, so there is zero flicker on warm switches.
    const albedoCached = mat.mapUrl ? _texCache.get(mat.mapUrl) ?? null : null;
    const normalCached = mat.normalUrl ? _texCache.get(mat.normalUrl) ?? null : null;
    const albedoReady = !mat.mapUrl || albedoCached;
    const normalReady = !mat.normalUrl || normalCached;

    if (albedoReady && normalReady) {
      begin(albedoCached, normalCached);
      return;
    }

    // Cold path: load the missing texture(s) FIRST, then start the flood, so it
    // always reveals the correct texture and never snaps mid/post-transition.
    // The "Loading texture..." indicator (driven by `loadingTex`) covers the
    // wait. `token` ensures a superseded switch can't apply a stale result.
    Promise.all([
      mat.mapUrl ? getCachedTexture(mat.mapUrl, false).catch(() => null) : Promise.resolve(null),
      mat.normalUrl ? getCachedTexture(mat.normalUrl, true).catch(() => null) : Promise.resolve(null),
    ]).then(([albedoTex, normalTex]) => begin(albedoTex, normalTex));
  }, [matIndex, invalidate]);

  /* -------- Live slider/scalar tweaks (no texture state here) -------- */
  // Handles user edits to the color/roughness/metalness/scalar sliders and the
  // texture-scale + env-intensity values for the CURRENT material. Textures are
  // owned by the transition effect above, so this never touches them.
  useEffect(() => {
    const m = sharedMatRef.current;
    const n = nodesRef.current;
    if (!m || !n) return;

    if (params.color) n.toColor.value.set(params.color as string);
    n.toRough.value = params.roughness ?? 0.5;
    n.toMetal.value = params.metalness ?? 0;
    n.triScale.value = triScale;
    if (m.envMapIntensity !== envIntensity) m.envMapIntensity = envIntensity;

    const target = computeScalars(params);
    morphRef.current.targetScalars = target;

    // When idle (slider tweak, not a transition), mirror "to" into "from" so the
    // at-rest display updates immediately, and apply the scalar PBR params now.
    // While a morph is active OR pending (a switch is mid-flight, possibly
    // waiting on a cold texture) we must leave the captured "from" snapshot
    // untouched — the transition effect owns it.
    if (!morphRef.current.active && !morphRef.current.pending) {
      n.fromColor.value.copy(n.toColor.value);
      n.fromRough.value = n.toRough.value;
      n.fromMetal.value = n.toMetal.value;
      n.fromIsTex.value = n.toIsTex.value;
      n.fromTex.value = n.toTex.value;
      applyScalars(m, target);
    }

    invalidate();
  }, [params, envIntensity, triScale, invalidate]);

  /* -------- Advance the liquid transition each frame -------- */
  useFrame((_, delta) => {
    const mo = morphRef.current;
    const n = nodesRef.current;
    const m = sharedMatRef.current;
    if (!mo.active || !n || !m) return;

    mo.t = Math.min(1, mo.t + delta / MORPH_DURATION);
    n.progress.value = easeInOutCubic(mo.t);

    // Snap the non-blended scalar PBR params (transmission/clearcoat/ior) at the
    // midpoint, when the flood front is roughly halfway across the object.
    if (!mo.scalarsApplied && mo.t >= 0.5) {
      applyScalars(m, mo.targetScalars);
      mo.scalarsApplied = true;
    }

    if (mo.t >= 1) {
      mo.active = false;
      // Fold "to" into "from" and reset progress so the at-rest display equals
      // the new material, ready for the next switch.
      n.fromColor.value.copy(n.toColor.value);
      n.fromRough.value = n.toRough.value;
      n.fromMetal.value = n.toMetal.value;
      n.fromIsTex.value = n.toIsTex.value;
      n.fromTex.value = n.toTex.value;
      n.progress.value = 0;
      applyScalars(m, mo.targetScalars);
    }

    invalidate();
  });

  /* -------- Assign shared material to all meshes -------- */
  useEffect(() => {
    const root = (isGLB ? groupRef.current : meshRef.current) as THREE.Object3D | null;
    if (!root) return;

    const assign = () => {
      root.updateWorldMatrix(true, true);
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.material = sharedMatRef.current!;
        }
      });

      // Center the triplanar projection + liquid mask on the object's bounding
      // box so texturing and the flood front are stable regardless of the
      // model's size/offset. invSpanY normalises the mask's vertical sweep to
      // the object's height.
      const box = new THREE.Box3().setFromObject(root);
      const center = new THREE.Vector3();
      const size = new THREE.Vector3();
      box.getCenter(center);
      box.getSize(size);
      const n = nodesRef.current;
      if (n) {
        n.pivot.value.copy(center);
        n.invSpanY.value = 1 / Math.max(size.y, 0.001);
      }

      invalidate();
    };

    // run now and once next frame (covers late-mounting GLB children)
    assign();
    const raf = requestAnimationFrame(assign);
    return () => cancelAnimationFrame(raf);
  }, [isGLB, glbPath, meshIndex, glbMountTick, invalidate]);

  /* Primitives: indices 5..9 */
  const primitive = !isGLB &&
    (() => {
      switch (meshDef?.name) {
        case 'Sphere':
          return <sphereGeometry args={[1, 64, 64]} />;
        case 'Box':
          return <boxGeometry args={[1.5, 1.5, 1.5]} />;
        case 'Torus':
          return <torusGeometry args={[1, 0.4, 32, 64]} />;
        case 'Cone':
          return <coneGeometry args={[1, 2, 24]} />;
        case 'Cylinder':
          return <cylinderGeometry args={[1, 1, 2, 64]} />;
        default:
          return <sphereGeometry args={[1, 64, 64]} />;
      }
    })();

  return (
    <>
      {isGLB ? (
        <group ref={groupRef} position={[0, 0, 0]} key={`glb-${glbPath}-${ctxVersion}`}>
          <Suspense fallback={null}>
            <GlbNode path={glbPath} onReady={handleGlbReady} />
          </Suspense>
        </group>
      ) : (
        <mesh ref={meshRef} position={[0, 0, 0]} castShadow key={`prim-${meshIndex}-${ctxVersion}`}>
          {primitive}
          <primitive attach="material" object={sharedMatRef.current!} />
        </mesh>
      )}

      {(loadingTex || loadingGlb) && (
        <Html center zIndexRange={[100, 0]}>
          <div className="px-4 py-2 rounded-lg bg-black/80 text-white text-sm font-medium pointer-events-none select-none backdrop-blur-sm">
            {loadingGlb && loadingTex ? 'Loading model & texture...' : loadingGlb ? 'Loading model...' : 'Loading texture...'}
          </div>
        </Html>
      )}

      {/* Floor removed: the reflective WaterMesh ocean (see SkyOcean) is the ground. */}

      {/* Fill lighting. The key "sun" directional light lives in <SunLight>
          (in the Canvas) so it can follow the SunControl without re-rendering
          this memoized Scene. */}
      <ambientLight intensity={0.3} />
      <pointLight position={[-10, -10, -5]} intensity={0.25} />
    </>
  );
});

/**
 * ============================================================================
 * THREECANVAS - ROOT COMPONENT
 * ============================================================================
 * Sets up the WebGPU-powered 3D viewer with automatic WebGL2 fallback.
 */
export function ThreeCanvas() {
  // ========== STATE MANAGEMENT ==========
  const [meshIndex, setMeshIndex] = useState(0);
  const [matIndex, setMatIndex] = useState(0);

  const [params, setParams] = useState<THREE.MeshPhysicalMaterialParameters & { color?: string }>(
    MATERIALS[0].base as THREE.MeshPhysicalMaterialParameters & { color?: string },
  );

  const canvasRef = useRef<HTMLDivElement>(null);

  const currentMapUrl = (MATERIALS[matIndex] as { mapUrl?: string }).mapUrl;
  const currentNormalUrl = (MATERIALS[matIndex] as { normalUrl?: string }).normalUrl;
  const [texScale, setTexScale] = useState(0.56);

  // ========== RENDERING SETTINGS (CONSTANT) ==========
  const exposure = React.useMemo(() => SCENE_EXPOSURE, []); // matches the ocean reference scene
  const envIntensity = React.useMemo(() => ENV_INTENSITY, []);
  const bgIntensity = React.useMemo(() => 1.0, []);
  const bgBlur = React.useMemo(() => 0.8, []);

  // Safe mode: enabled after a context loss; reduces quality to recover.
  const [safeMode, setSafeMode] = useState(false);
  const [ctxVersion, setCtxVersion] = useState(0);

  // True once we confirm the active backend is WebGPU. TSL post-processing
  // (bloom/lens flare) only mounts in that case; the WebGL2 fallback keeps
  // R3F's normal auto-render.
  const [isWebGPU, setIsWebGPU] = useState(false);

  // ========== PERFORMANCE: pause rendering when the hero is off-screen ==========
  // Auto-rotation needs a continuous loop while visible, but there's no reason to
  // keep the GPU busy once the user has scrolled to another section.
  const [frameloop, setFrameloop] = useState<'always' | 'never' | 'demand'>('always');

  // ========== UI STATE ==========
  const [panelOpen, setPanelOpen] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const handleSceneReady = useCallback(() => setSceneReady(true), []);

  // ========== LOADING GATE ==========
  // The 3D scene stays hidden behind a full-screen loading overlay until:
  //   1. EVERY asset is downloaded/decoded — all material textures (albedo +
  //      normal), all GLB meshes, the HDR environment and the water normals —
  //      so switching mesh/material later is instant (no mid-session fetch).
  //   2. The current scene's WebGPU shaders are compiled (see <ShaderCompiler>).
  // `assetsReady` covers (1); `shadersReady` covers (2); `sceneReady` confirms
  // the initial mesh + material are mounted. `appReady` is the AND of all three.
  const [assetsReady, setAssetsReady] = useState(false);
  const [shadersReady, setShadersReady] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const appReady = assetsReady && sceneReady && shadersReady;
  const handleShadersReady = useCallback(() => setShadersReady(true), []);

  // Keep the overlay mounted briefly after readiness so it can fade out.
  const [overlayGone, setOverlayGone] = useState(false);
  useEffect(() => {
    if (!appReady) return;
    const t = window.setTimeout(() => setOverlayGone(true), 650);
    return () => window.clearTimeout(t);
  }, [appReady]);

  // Preload EVERYTHING up front, behind the loading screen. Textures go through
  // the shared `_texCache` (so the morph and the swatches reuse them); GLBs +
  // HDR + water normals are fetched so the browser HTTP-caches them (drei's
  // useGLTF.preload + Environment then parse straight from that cache). Progress
  // drives the overlay's percentage.
  useEffect(() => {
    let cancelled = false;

    const texUrls: Array<[string, boolean]> = [];
    for (const mm of MATERIALS) {
      const m = mm as { mapUrl?: string; normalUrl?: string };
      if (m.mapUrl) texUrls.push([m.mapUrl, false]);
      if (m.normalUrl) texUrls.push([m.normalUrl, true]);
    }
    const glbUrls = (MESHES as Array<{ glb?: string }>)
      .map((m) => m.glb)
      .filter((g): g is string => typeof g === 'string');
    const extraUrls = ['/sunset.hdr', '/waternormals.jpg'];

    const total = texUrls.length + glbUrls.length + extraUrls.length;
    let done = 0;
    const bump = () => {
      if (cancelled) return;
      done += 1;
      setLoadProgress(done / total);
    };

    const texJobs = texUrls.map(([url, isNormal]) =>
      getCachedTexture(url, isNormal).then(bump).catch(bump),
    );

    // Fetch the binary assets so they sit in the HTTP cache; drei's GLTF cache
    // + the Environment loader then resolve instantly from it. Reading the body
    // ensures the download actually completed before we count it as ready.
    const fetchJob = (url: string) =>
      fetch(url)
        .then((r) => r.arrayBuffer())
        .then(() => bump())
        .catch(() => bump());
    const glbJobs = glbUrls.map((url) => {
      const job = fetchJob(url);
      try { useGLTF.preload(url); } catch {}
      return job;
    });
    const extraJobs = extraUrls.map(fetchJob);

    Promise.all([...texJobs, ...glbJobs, ...extraJobs]).then(() => {
      if (!cancelled) setAssetsReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // ========== SUN STATE (driven by the SunControl overlay) ==========
  // dayAngle 0..180 along the arc; initialised from the shared DEFAULT_* values
  // so the control knob and the scene's sun start in agreement. azimuth = rotation.
  const [dayAngle, setDayAngle] = useState<number>(DEFAULT_DAY_ANGLE);
  const [sunAzimuth, setSunAzimuth] = useState<number>(DEFAULT_SUN_AZIMUTH);
  // Shared sun direction: drives the sky scattering, ocean specular, and the
  // directional key light, so sunset/dawn sit on opposite sides of the sky.
  const sunDir = React.useMemo(
    () => sunDirectionFromState(dayAngle, sunAzimuth),
    [dayAngle, sunAzimuth],
  );

  const isGlass = (params.transmission ?? 0) > 0.01;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPanelOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Pause/resume the render loop based on canvas visibility.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      ([entry]) => setFrameloop(entry.isIntersecting ? 'always' : 'never'),
      { threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Disable touch scroll in the first section (mobile only) so orbit works.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const isInFirstSection = () => {
      const heroSection = document.getElementById('hero');
      if (!heroSection) return false;
      const rect = heroSection.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      return rect.top > -viewportHeight * 0.3 && rect.bottom > viewportHeight * 0.7;
    };

    const handleTouchMove = (e: TouchEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('.ui-range, .ui-select, .ui-button, input, select, button, [data-no-snap]')) {
        return;
      }
      if (isInFirstSection()) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    return () => {
      canvas.removeEventListener('touchmove', handleTouchMove);
    };
  }, []);

  useEffect(() => {
    setParams((prev) => {
      const base = MATERIALS[matIndex].base as Partial<THREE.MeshPhysicalMaterialParameters & { color?: string }>;
      const next: THREE.MeshPhysicalMaterialParameters & { color?: string } = { ...prev, ...base };
      if (currentMapUrl) {
        delete (next as { color?: string }).color;
      }
      return next;
    });
  }, [matIndex, currentMapUrl]);

  const panelVars: CSSProperties & Record<'--panel-top' | '--panel-bottom', string> = {
    '--panel-top': 'calc(env(safe-area-inset-top) + 72px)',
    '--panel-bottom': 'calc(env(safe-area-inset-bottom) + 24px)',
  };

  return (
    <div ref={canvasRef} className="w-full h-screen relative">
      <Canvas
        shadows={!safeMode}
        style={{ touchAction: 'pan-y' }}
        className="w-full h-full"
        dpr={safeMode ? 1 : [1, 1.5]}
        frameloop={frameloop}
        // Async WebGPU renderer factory. R3F v9 natively supports returning a
        // promise here. WebGPURenderer uses WebGPU when available and transparently
        // falls back to a WebGL2 backend otherwise.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        gl={(async (props: any) => {
          const renderer = new THREE.WebGPURenderer({
            ...props,
            antialias: !safeMode,
            powerPreference: 'high-performance',
            forceWebGL: false,
            alpha: false,
          });
          await renderer.init();
          return renderer;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }) as any}
        camera={{ position: [0, 0, 4], fov: 50, near: 0.1, far: 20000 }}
        performance={{ min: 0.5, max: 1, debounce: 50 }}
        onCreated={(state) => {
          const gl = state.gl as AnyRenderer;
          const scene = state.scene as THREE.Scene;
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.outputColorSpace = THREE.SRGBColorSpace;
          const webgpu = !!gl?.backend?.isWebGPUBackend;
          setIsWebGPU(webgpu);
          // eslint-disable-next-line no-console
          console.log(`[3D] Renderer backend: ${webgpu ? 'WebGPU' : 'WebGL2 (fallback)'}`);
          const s = scene as SceneWithBg;
          s.backgroundIntensity = 1;
          s.backgroundBlurriness = 1;
        }}
      >
        <Exposure value={exposure} />
        <SceneEnvIntensity value={envIntensity} />
        <BackgroundTune intensity={bgIntensity} blur={bgBlur} />
        <ContextLossProtector
          onLost={() => setSafeMode(true)}
          onRestored={() => {
            setCtxVersion((v) => v + 1);
            setSafeMode(false);
          }}
        />

        {/* Sunset HDR provides the model's ambient lighting + reflections.
            No `background` prop, so the analytic sky stays the visible backdrop.
            environmentIntensity is kept in sync with ENV_INTENSITY so drei
            doesn't reset the scene-level intensity after SceneEnvIntensity runs. */}
        <Environment
          key={`env-${ctxVersion}`}
          files="/sunset.hdr"
          environmentIntensity={envIntensity}
        />

        {/* WebGPU analytic sky + reflective ocean (replaces the old floor) */}
        <SkyOcean
          key={`skyocean-${ctxVersion}`}
          sunDirection={sunDir}
          oceanY={OCEAN_Y}
          exposure={exposure}
        />

        {/* Key "sun" light, follows the same direction as the sky/ocean sun */}
        <SunLight sunDirection={sunDir} safeMode={safeMode} />

        <Suspense fallback={null}>
          <Scene
            meshIndex={meshIndex}
            matIndex={matIndex}
            params={params}
            envIntensity={envIntensity}
            safeMode={safeMode}
            mapUrl={currentMapUrl}
            triScale={texScale}
            ctxVersion={ctxVersion}
            onReady={handleSceneReady}
          />
          <Preload all />
        </Suspense>

        <SmartOrbitControls />

        {/* Precompile shaders before lifting the loading overlay. Gated on the
            assets being downloaded AND the initial mesh/material being mounted
            so compileAsync sees the real material graph. */}
        <ShaderCompiler active={assetsReady && sceneReady} onCompiled={handleShadersReady} />

        {/* Bloom + lens flare. Mounted only on the WebGPU backend and
            outside safeMode; it takes over the render loop via a priority frame
            callback, so on the WebGL2 fallback R3F keeps auto-rendering. */}
        {isWebGPU && !safeMode && <PostFX key={`postfx-${ctxVersion}`} />}
      </Canvas>

      {/* Full-screen loading overlay — opaque, so the 3D scene is never visible
          until every asset is downloaded and the shaders are compiled. */}
      {!overlayGone && (
        <div
          aria-hidden={appReady}
          className={`absolute inset-0 z-[80] flex flex-col items-center justify-center bg-black
                      transition-opacity duration-500 ease-out
                      ${appReady ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
        >
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-white/90" />
          <div className="mt-5 w-48 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-1 rounded-full bg-white/80 transition-[width] duration-200 ease-out"
              style={{ width: `${Math.round((appReady ? 1 : loadProgress) * 100)}%` }}
            />
          </div>
          <p className="mt-3 text-xs font-medium tracking-wide text-white/70">
            {appReady ? 'Ready' : `Loading 3D scene… ${Math.round(loadProgress * 100)}%`}
          </p>
        </div>
      )}

      {/* UI CONTROLS - Only shown once everything is loaded + compiled */}
      {appReady && (
        <>
          {/* Sun control (bottom-right, below the control panel): drives sky scattering + ocean specular */}
          <SunControl
            dayAngle={dayAngle}
            azimuth={sunAzimuth}
            onDayAngle={setDayAngle}
            onAzimuth={setSunAzimuth}
          />

          {/* Hamburger button for mobile */}
          <button
            type="button"
            aria-label="Toggle controls"
            aria-expanded={panelOpen}
            onClick={() => setPanelOpen((v) => !v)}
            className="fixed z-[65] right-4
                       top-[calc(env(safe-area-inset-top)+88px)]
                       lg:top-24
                       rounded-full px-3 py-2 bg-violet-400/80 text-white shadow-lg backdrop-blur
                       hover:bg-purple-500/90 focus:outline-none focus:ring-2 focus:ring-purple-400/50
                       lg:hidden
                       animate-in fade-in slide-in-from-right-4 duration-300"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>

          {panelOpen && (
            <button aria-label="Close controls" onClick={() => setPanelOpen(false)} className="fixed inset-0 z-[55] bg-black/40 backdrop-blur-sm lg:hidden" />
          )}

          {/* Control panel drawer */}
          <div
            role="dialog"
            aria-modal="true"
            style={panelVars}
            className={`
              ui-card z-[60] p-3 pointer-events-auto
              fixed right-4 w-[min(320px,92vw)]
              top-[var(--panel-top)]
              max-h-[calc(100svh-var(--panel-top)-var(--panel-bottom))] overflow-y-auto overscroll-contain
              transform transition-transform duration-300 ease-out
              ${panelOpen ? 'translate-x-0' : 'translate-x-[calc(100%+1rem)]'}
              lg:absolute lg:right-12 lg:top-24 lg:max-h-[calc(100svh-21rem)] lg:translate-x-0
              lg:animate-in lg:fade-in lg:slide-in-from-right-4 lg:duration-500
            `}
          >
            {/* Mesh */}
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="mesh" className="text-xs opacity-80">
                Mesh
              </label>
              <select id="mesh" className="ui-select" value={meshIndex} onChange={(e) => setMeshIndex(Number(e.target.value))}>
                {MESHES.map((m, i) => (
                  <option key={m.name} value={i}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Material — 4×5 grid of circular swatch thumbnails. Texture
                materials show their image; color materials show their hex; Glass
                and Chrome use a representative gradient. */}
            <div className="mt-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs opacity-80">Material</span>
                <span className="text-xs font-medium text-white/90">{MATERIALS[matIndex].name}</span>
              </div>
              <div className="mt-2 grid grid-cols-5 gap-2">
                {MATERIALS.map((m, i) => {
                  const mat = m as { name: string; mapUrl?: string; thumb?: string; base: { color?: string } };
                  const swatchStyle: CSSProperties = mat.mapUrl
                    ? { backgroundImage: `url(${mat.mapUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                    : mat.thumb
                      ? { backgroundImage: mat.thumb }
                      : { backgroundColor: mat.base.color || '#ffffff' };
                  const selected = matIndex === i;
                  return (
                    <button
                      key={mat.name}
                      type="button"
                      title={mat.name}
                      aria-label={mat.name}
                      aria-pressed={selected}
                      onClick={() => setMatIndex(i)}
                      style={swatchStyle}
                      className={`relative mx-auto aspect-square w-[78%] rounded-full bg-cover bg-center shadow-md outline-none transition-transform duration-150 hover:scale-110 focus-visible:ring-2 focus-visible:ring-white/80 ${
                        selected
                          ? 'scale-105 ring-2 ring-white ring-offset-2 ring-offset-purple-950/60'
                          : 'ring-1 ring-white/20'
                      }`}
                    />
                  );
                })}
              </div>
            </div>

            {/* Controls */}
            <div className="mt-3 mb-2 space-y-2">
              {!currentMapUrl && (
                <Color label="Albedo" value={(params.color as string) || '#ffffff'} onChange={(hex) => setParams((p) => ({ ...p, color: hex }))} />
              )}
              {(currentMapUrl || currentNormalUrl) && <Slider label="Texture Scale" min={0.3} max={3} step={0.01} value={texScale} onChange={setTexScale} />}
              <Slider
                label="Roughness"
                min={0}
                max={1}
                step={0.01}
                value={params.roughness ?? 0.5}
                onChange={(v) => setParams((p) => ({ ...p, roughness: v }))}
              />
              <Slider
                label="Metalness"
                min={0}
                max={1}
                step={0.01}
                value={params.metalness ?? 0}
                onChange={(v) => setParams((p) => ({ ...p, metalness: v }))}
              />

              {isGlass && (
                <>
                  <Slider label="IOR" min={1} max={2.333} step={0.001} value={params.ior ?? 1.5} onChange={(v) => setParams((p) => ({ ...p, ior: v }))} />
                  <Slider
                    label="Transmission"
                    min={0}
                    max={1}
                    step={0.01}
                    value={params.transmission ?? 0}
                    onChange={(v) => setParams((p) => ({ ...p, transmission: v }))}
                  />
                  <Slider
                    label="Thickness"
                    min={0}
                    max={2}
                    step={0.01}
                    value={params.thickness ?? 0}
                    onChange={(v) => setParams((p) => ({ ...p, thickness: v }))}
                  />
                </>
              )}

              {!isGlass && (
                <>
                  <Slider
                    label="Clearcoat"
                    min={0}
                    max={1}
                    step={0.01}
                    value={params.clearcoat ?? 0}
                    onChange={(v) => setParams((p) => ({ ...p, clearcoat: v }))}
                  />
                  <Slider
                    label="Clearcoat Roughness"
                    min={0}
                    max={1}
                    step={0.01}
                    value={params.clearcoatRoughness ?? 0}
                    onChange={(v) => setParams((p) => ({ ...p, clearcoatRoughness: v }))}
                  />
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* --------------------------- Small UI helpers --------------------------- */
function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex justify-between text-[11px] mb-0.5">
        <span className="opacity-80">{label}</span>
        <span className="tabular-nums opacity-60">{value.toFixed(3)}</span>
      </div>
      <input
        className="ui-range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={`Adjust ${label}`}
      />
    </div>
  );
}

function Color({ label, value, onChange }: { label: string; value: string; onChange: (hex: string) => void }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <label className="text-xs opacity-80">{label}</label>
      <input className="ui-select h-8 p-1 w-28" type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label={`Select ${label} color`} />
    </div>
  );
}

/* ---- Preload GLB models so they're ready on first interaction ---- */
try { useGLTF.preload('/glb1.glb'); } catch {}
[2, 3, 4, 5].forEach((n) => { try { useGLTF.preload(`/glb${n}.glb`); } catch {} });

// Warm up the first texture (Texture 1) so it's ready on first frame.
const _prewarmTex = (() => {
  let started = false;
  return () => {
    if (started || typeof window === 'undefined') return;
    started = true;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.src = '/texture1.jpg';
  };
})();
_prewarmTex();
