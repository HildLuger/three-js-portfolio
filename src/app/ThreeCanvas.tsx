'use client';

// React and type imports
import * as React from 'react';
import type { CSSProperties } from 'react';
import { useRef, useEffect, useState, Suspense, memo } from 'react';

// React Three Fiber - React renderer for Three.js
import { Canvas, useThree } from '@react-three/fiber';

// Drei - useful helpers and components for R3F
import { OrbitControls, Environment, useGLTF, Html, Preload } from '@react-three/drei';

// Three.js - 3D library
import * as THREE from 'three';

// GSAP - animation library (used for smooth transitions)
import gsap from 'gsap';

/**
 * Check if the browser supports WebGPU (the next-generation graphics API).
 * WebGPU provides better performance than WebGL on supported browsers.
 */
const IS_WEBGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;

/**
 * Minimal TypeScript type for GLTF models loaded with useGLTF.
 * We only care about the 'scene' property which contains the 3D object.
 */
type GLTFLike = { scene: THREE.Object3D };

/**
 * ============================================================================
 * WEBGPU RENDERER LOADER
 * ============================================================================
 * This section handles loading the WebGPU renderer dynamically.
 * WebGPU is a modern graphics API that provides better performance than WebGL.
 */

/**
 * TypeScript type for the WebGPU renderer constructor.
 * We define it manually to avoid importing WebGPU-specific types.
 */
type WebGPUCtor = new (opts: { canvas: HTMLCanvasElement; antialias?: boolean }) => {
  init?: () => Promise<void>;
};

/**
 * Dynamically load the WebGPU renderer from Three.js.
 * 
 * This function:
 * 1. Checks if the browser supports WebGPU
 * 2. Tries to load from the newer 'three/webgpu' export (Three.js r150+)
 * 3. Falls back to the legacy addons path for older Three.js versions
 * 4. Returns null if WebGPU is not available or loading fails
 * 
 * @returns Promise that resolves to the WebGPURenderer constructor or null
 */
async function loadWebGPURenderer(): Promise<WebGPUCtor | null> {
  if (!IS_WEBGPU) return null;
  
  // Try newer Three.js export path (recommended)
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = (await import('three/webgpu')) as any;
    return mod?.WebGPURenderer ?? null;
  } catch {
    // Fallback: try older Three.js addons path for backwards compatibility
    try {
      // Dynamic import using Function constructor to bypass bundler resolution
      // This allows us to build the path at runtime
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const importShim: (s: string) => Promise<any> =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (new Function('s', 'return import(s)')) as any;
      const legacyPath = ['three','addons','renderers','webgpu','WebGPURenderer.js'].join('/');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod2 = await importShim(legacyPath) as any;
      return mod2?.WebGPURenderer ?? null;
    } catch {
      return null;
    }
  }
}
/**
 * ============================================================================
 * THREE.JS OPTIMIZATION & UTILITIES
 * ============================================================================
 */

/**
 * Enable Three.js caching system for better performance.
 * This caches loaded assets (textures, models) to avoid reloading them.
 */
THREE.Cache.enabled = true;

/**
 * Log WebGPU availability status to the console for debugging.
 * Helps developers know if WebGPU is being used or if it falls back to WebGL.
 */
if (typeof window !== 'undefined') {
  console.log('WebGPU Available:', 'gpu' in navigator);
}

/**
 * ============================================================================
 * GLB MODEL LOADER COMPONENT
 * ============================================================================
 * This component loads 3D models in GLB/GLTF format and notifies when ready.
 */

/**
 * GlbNode - Loads and renders a GLB/GLTF 3D model file.
 * 
 * This component:
 * 1. Uses useGLTF hook to load the model (with automatic caching)
 * 2. Extracts the scene object from the loaded GLTF
 * 3. Memoizes the node to prevent unnecessary re-renders
 * 4. Notifies parent component when the model is ready
 * 
 * @param path - File path to the GLB/GLTF model
 * @param onReady - Callback function called when the model is loaded and mounted
 */
function GlbNode({ path, onReady }: { path: string; onReady?: () => void }) {
  // Load the GLTF model using Drei's useGLTF hook (handles caching automatically)
  const gltf = useGLTF(path) as unknown as GLTFLike;
  
  // Memoize the scene node to avoid recreating it on every render
  // Falls back to an empty group if the model hasn't loaded yet
  const node = React.useMemo(
    () => (gltf?.scene ?? new THREE.Group()) as THREE.Object3D,
    [gltf]
  );

  // Notify parent component when the model is ready
  // We depend on 'gltf' instead of 'node' to avoid retriggering when materials are assigned
  React.useEffect(() => {
    onReady?.();
  }, [onReady, gltf]);
  
  return <primitive object={node} />;
}

/**
 * ============================================================================
 * WEBGL CONTEXT LOSS PROTECTION
 * ============================================================================
 * Handles WebGL context loss/restore events (when GPU resources are lost).
 */

/**
 * ContextLossProtector - Monitors and handles WebGL context loss events.
 * 
 * Context loss can occur when:
 * - GPU driver crashes
 * - Browser tab is suspended for too long
 * - Device runs out of GPU memory
 * - User switches graphics cards (laptops)
 * 
 * This component:
 * 1. Listens for 'webglcontextlost' events and prevents default behavior
 * 2. Notifies parent component to enable safe mode (reduced quality)
 * 3. Listens for 'webglcontextrestored' events
 * 4. Restores renderer settings and notifies parent to resume normal operation
 * 
 * @param onLost - Callback when WebGL context is lost
 * @param onRestored - Callback when WebGL context is restored
 */
function ContextLossProtector({ onLost, onRestored }: { onLost?: () => void; onRestored?: () => void }) {
  const { gl } = useThree();
  
  useEffect(() => {
    const c = gl.domElement as HTMLCanvasElement;

    // Handle context loss: prevent default and notify parent
    const handleLost = (e: Event) => {
      e.preventDefault(); // Allows context to be restored
      onLost?.();
    };
    
    // Handle context restore: reset renderer settings and notify parent
    const handleRestored = () => {
      (gl as THREE.WebGLRenderer).toneMapping = THREE.ACESFilmicToneMapping;
      (gl as THREE.WebGLRenderer).outputColorSpace = THREE.SRGBColorSpace;
      onRestored?.();
    };

    // Register event listeners
    c.addEventListener('webglcontextlost', handleLost as EventListener, { passive: false });
    c.addEventListener('webglcontextrestored', handleRestored as EventListener);

    // Cleanup listeners on unmount
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
 * These components control various rendering properties.
 * They are memoized to prevent unnecessary re-renders when parent state changes.
 */

/**
 * Exposure - Controls the overall brightness of the rendered scene.
 * 
 * Tone mapping exposure determines how bright the final image appears.
 * Higher values = brighter image, lower values = darker image.
 * 
 * This component:
 * - Sets the renderer's toneMappingExposure value
 * - Restores the previous value on unmount
 * - Is memoized to only re-render when 'value' changes
 * 
 * @param value - Exposure value (typically 0.5 - 1.5, default: 0.62)
 */
const Exposure = memo(function Exposure({ value = 0.62 }: { value: number }) {
  const { gl } = useThree();
  
  useEffect(() => {
    const renderer = gl as THREE.WebGLRenderer;
    const prev = renderer.toneMappingExposure;
    renderer.toneMappingExposure = value;
    
    return () => {
      renderer.toneMappingExposure = prev;
    };
  }, [gl, value]);
  
  return null;
});

/**
 * TypeScript extension of THREE.Scene to include environmentIntensity property.
 * This property controls how strongly the environment map affects materials.
 */
type SceneWithEnvIntensity = THREE.Scene & { environmentIntensity?: number };

/**
 * SceneEnvIntensity - Controls the intensity of environment map reflections.
 * 
 * The environment map provides realistic reflections and ambient lighting.
 * This multiplier affects how strongly materials reflect the environment.
 * 
 * This component:
 * - Sets the scene's environmentIntensity
 * - Affects all materials that use environment maps
 * - Is memoized to prevent unnecessary re-renders
 * 
 * @param value - Intensity multiplier (0 = no environment, 1 = full strength, default: 0.6)
 */
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

/**
 * TypeScript extension of THREE.Scene to include background properties.
 * These properties control the appearance of the environment background.
 */
type SceneWithBg = THREE.Scene & { backgroundIntensity?: number; backgroundBlurriness?: number };

/**
 * BackgroundTune - Controls the intensity and blur of the environment background.
 * 
 * This component:
 * - backgroundIntensity: Controls how bright the background appears
 * - backgroundBlurriness: Controls how blurry/defocused the background is
 * - Is memoized to prevent unnecessary re-renders
 * 
 * @param intensity - Background brightness (0 = black, 1 = full brightness, default: 1.0)
 * @param blur - Background blur amount (0 = sharp, 1 = very blurry, default: 0.8)
 */
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
 * SmartOrbitControls - OrbitControls with demand frameloop integration.
 * 
 * This component ensures auto-rotate never freezes by:
 * - Continuously invalidating frames when auto-rotating
 * - Handling camera changes during user interaction
 * - Using requestAnimationFrame loop for smooth auto-rotation
 */
const SmartOrbitControls = memo(function SmartOrbitControls() {
  const controlsRef = useRef<React.ElementRef<typeof OrbitControls>>(null);
  const { invalidate } = useThree();
  const rafRef = useRef<number | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    // Detect mobile device
    setIsMobile(window.innerWidth < 768);
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;

    // Continuously invalidate frames for auto-rotate
    // This prevents auto-rotate from freezing with frameloop="demand"
    const loop = () => {
      invalidate();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    // Also invalidate on change for immediate user interaction response
    const handleChange = () => {
      invalidate();
    };

    controls.addEventListener('change', handleChange);

    return () => {
      controls.removeEventListener('change', handleChange);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [invalidate]);

  return (
    <OrbitControls
      ref={controlsRef}
      enableDamping
      dampingFactor={0.1}
      enablePan={false}
      enableZoom={isMobile}
      minDistance={isMobile ? 4 : undefined}
      maxDistance={isMobile ? 10 : undefined}
      autoRotate
      autoRotateSpeed={2}
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
 * FrameInvalidator - Keeps the canvas updating when needed.
 * 
 * With frameloop="demand", we only render when something changes.
 * This component ensures smooth animation by invalidating frames
 * when controls are active or auto-rotating.
 */
function FrameInvalidator() {
  const { invalidate } = useThree();
  
  useEffect(() => {
    // Invalidate on mount to ensure initial render
    invalidate();
  }, [invalidate]);
  
  return null;
}


/**
 * ============================================================================
 * MESH & MATERIAL CATALOGS
 * ============================================================================
 * These arrays define the available 3D models and material presets.
 */

/**
 * MESHES - Array of available 3D objects.
 * 
 * - First 5 items (indices 0-4) are GLB/GLTF model files
 * - Remaining items (indices 5-9) are procedural Three.js geometries
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

/**
 * MATERIALS - Array of material presets with different properties.
 * 
 * Each material defines physical properties:
 * - metalness: How metallic the surface is (0 = dielectric, 1 = metal)
 * - roughness: Surface roughness (0 = mirror smooth, 1 = completely rough)
 * - ior: Index of Refraction for glass/transparent materials (1.5 = typical glass)
 * - transmission: Transparency through the material (0 = opaque, 1 = transparent)
 * - thickness: Virtual thickness for transparent materials
 * - clearcoat: Extra glossy layer on top (like car paint)
 * - clearcoatRoughness: Roughness of the clearcoat layer
 * 
 * First 9 materials have texture maps (mapUrl), rest use solid colors.
 */
const MATERIALS = [
  // Textured materials (with image maps)
  { name: 'Texture 1', base: { metalness: 0.0, roughness: 0.2, ior: 1.5, transmission: 0, thickness: 0, clearcoat: 0, clearcoatRoughness: 0 }, mapUrl: '/texture1.jpg' },
  { name: 'Texture 2', base: { metalness: 0.2, roughness: 0.2, ior: 1.5, transmission: 0, thickness: 0, clearcoat: 0, clearcoatRoughness: 0 }, mapUrl: '/texture2.jpg' },
  { name: 'Texture 3', base: { metalness: 0.0, roughness: 0.2, ior: 1.5, transmission: 0, thickness: 0, clearcoat: 0.1, clearcoatRoughness: 0.2 }, mapUrl: '/texture3.jpg' },
  { name: 'Texture 4', base: { metalness: 0.6, roughness: 0.2, ior: 1.5, transmission: 0, thickness: 0, clearcoat: 0.2, clearcoatRoughness: 0.3 }, mapUrl: '/texture4.jpg' },
  { name: 'Texture 5', base: { metalness: 0.0, roughness: 0.2, ior: 1.5, transmission: 0, thickness: 0, clearcoat: 0, clearcoatRoughness: 0 }, mapUrl: '/texture5.jpg' },
  { name: 'Texture 6', base: { metalness: 0.0, roughness: 0.2, ior: 1.5, transmission: 0, thickness: 0, clearcoat: 0, clearcoatRoughness: 0 }, mapUrl: '/texture6.jpg' },
  { name: 'Texture 7', base: { metalness: 0.0, roughness: 0.2, ior: 1.5, transmission: 0, thickness: 0, clearcoat: 0, clearcoatRoughness: 0 }, mapUrl: '/texture7.jpg' },
  { name: 'Texture 8', base: { metalness: 0.0, roughness: 0.2, ior: 1.5, transmission: 0, thickness: 0, clearcoat: 0, clearcoatRoughness: 0 }, mapUrl: '/texture8.jpg' },
  { name: 'Texture 9', base: { metalness: 0.0, roughness: 0.2, ior: 1.5, transmission: 0, thickness: 0, clearcoat: 0, clearcoatRoughness: 0 }, mapUrl: '/texture9.jpg' },

  // Solid color materials
  { name: 'Default', base: { color: '#8976b8', metalness: 0, roughness: 0.1, ior: 1.5, transmission: 0, thickness: 0, clearcoat: 0, clearcoatRoughness: 0 } },
  { name: 'Metal', base: { color: '#c0c0c0', metalness: 1, roughness: 0.1, ior: 1.5, transmission: 0, thickness: 0, clearcoat: 0, clearcoatRoughness: 0 } },
  { name: 'Glass', base: { color: '#ffffff', metalness: 0, roughness: 0.1, ior: 1.5, transmission: 1, thickness: 1, clearcoat: 0, clearcoatRoughness: 0 } },
  { name: 'Rough', base: { color: '#8ec78f', metalness: 0, roughness: 0.9, ior: 1.5, transmission: 0, thickness: 0, clearcoat: 0, clearcoatRoughness: 0 } },
  { name: 'Chrome', base: { color: '#ffffff', metalness: 1, roughness: 0.0, ior: 1.5, transmission: 0, thickness: 0, clearcoat: 0, clearcoatRoughness: 0 } },
];

/**
 * ============================================================================
 * WEBGL TRIPLANAR TEXTURE MAPPING
 * ============================================================================
 * Triplanar mapping applies textures to complex 3D models without UVs.
 * It projects the texture from 3 directions (X, Y, Z) and blends them.
 * Only used for WebGL (WebGPU uses a different approach with box projection).
 */
/**
 * TypeScript type for triplanar mapping shader uniforms.
 * These values are passed to the custom shader for texture projection.
 */
type TriUniforms = {
  triMap: { value: THREE.Texture | null };      // The texture to project
  triScale: { value: number };                   // Texture tiling/scaling
  triSharp: { value: number };                   // Blend sharpness between projections
  triPivot: { value: THREE.Vector3 };           // Center point for projection
};

/**
 * Extended material type that includes triplanar uniforms in userData.
 */
type MaterialWithTri = THREE.MeshPhysicalMaterial & {
  userData: THREE.MeshPhysicalMaterial['userData'] & { triUniforms?: TriUniforms };
};

/**
 * applyTriplanar - Modifies a material's shader to use triplanar texture mapping.
 * 
 * How triplanar mapping works:
 * 1. Project the texture from 3 directions (X, Y, Z axes)
 * 2. Sample the texture 3 times based on world position
 * 3. Blend the 3 samples based on surface normal direction
 * 
 * Benefits:
 * - Works on any geometry without UV coordinates
 * - No texture stretching or distortion
 * - Automatic texture alignment
 * 
 * This function injects custom GLSL code into Three.js's shader at specific points.
 * 
 * @param material - The material to modify with triplanar mapping
 */
function applyTriplanar(material: MaterialWithTri) {
  material.userData.triUniforms ??= {
    triMap: { value: null },
    triScale: { value: 1.0 },
    triSharp: { value: 2.0 },
    triPivot: { value: new THREE.Vector3() },
  };
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `
        #include <common>
        varying vec3 vWPos;
        varying vec3 vWNorm;
      `,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `
        #include <beginnormal_vertex>
        vWNorm = normalize(mat3(modelMatrix) * objectNormal);
      `,
      )
      .replace(
        '#include <begin_vertex>',
        `
        #include <begin_vertex>
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
      `,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <map_pars_fragment>',
        `
        #include <map_pars_fragment>
        varying vec3 vWPos;
        varying vec3 vWNorm;
        uniform sampler2D triMap;
        uniform float triScale;
        uniform float triSharp;
        uniform vec3  triPivot;
        vec3 triBlend(vec3 n) {
          vec3 an = abs(n);
          an = pow(an, vec3(triSharp));
          return an / (an.x + an.y + an.z + 1e-5);
        }
        vec4 triSample(vec3 p, vec3 n){
          vec3 pc = (p - triPivot);
          vec3 an = abs(normalize(n));
          if (an.x > an.y && an.x > an.z) {
            vec2 uv = fract(pc.zy * triScale + 0.5);
            return texture2D(triMap, uv);
          } else if (an.y > an.z) {
            vec2 uv = fract(pc.xz * triScale + 0.5);
            return texture2D(triMap, uv);
          } else {
            vec2 uv = fract(pc.xy * triScale + 0.5);
            return texture2D(triMap, uv);
          }
        }
      `,
      )
      .replace(
        '#include <map_fragment>',
        `
        vec4 sampledDiffuseColor = triSample(vWPos, vWNorm);
        diffuseColor *= sampledDiffuseColor;
      `,
      );
    shader.uniforms.triMap = material.userData.triUniforms!.triMap;
    shader.uniforms.triScale = material.userData.triUniforms!.triScale;
    shader.uniforms.triSharp = material.userData.triUniforms!.triSharp;
    shader.uniforms.triPivot = material.userData.triUniforms!.triPivot;
  };
  material.needsUpdate = true;
}

/**
 * ============================================================================
 * WEBGPU BOX-PROJECTED UV GENERATION
 * ============================================================================
 * WebGPU doesn't support custom shaders like the triplanar approach.
 * Instead, we pre-generate UV coordinates using box projection.
 */

/**
 * boxProjectUVsCentered - Generates UV coordinates using box projection.
 * 
 * Box projection works by:
 * 1. Finding the center and size of the object
 * 2. For each vertex, determining which axis it faces (X, Y, or Z)
 * 3. Projecting UV coordinates from that axis onto the vertex
 * 4. Centering coordinates around 0.5 to avoid texture seams
 * 
 * This creates proper UV coordinates for any geometry, similar to triplanar
 * but pre-computed instead of done in the shader.
 * 
 * @param geo - The geometry to generate UVs for
 * @param obj - The 3D object (for world transform)
 * @param pivotWS - Center point in world space
 * @param sizeRef - Reference size for normalization
 */
function boxProjectUVsCentered(
  geo: THREE.BufferGeometry,
  obj: THREE.Object3D,
  pivotWS: THREE.Vector3,
  sizeRef: number,
) {
  if (!geo.attributes.position) return;
  if (!geo.attributes.normal) geo.computeVertexNormals();

  const pos = geo.attributes.position as THREE.BufferAttribute;
  const norm = geo.attributes.normal as THREE.BufferAttribute;
  const nMat = new THREE.Matrix3().getNormalMatrix(obj.matrixWorld);

  const uvs = new Float32Array(pos.count * 2);

  for (let i = 0; i < pos.count; i++) {
    const wp = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(obj.matrixWorld);
    const wn = new THREE.Vector3(norm.getX(i), norm.getY(i), norm.getZ(i)).applyMatrix3(nMat).normalize();

    const pc = wp.sub(pivotWS).divideScalar(sizeRef);

    const nx = Math.abs(wn.x);
    const ny = Math.abs(wn.y);
    const nz = Math.abs(wn.z);

    const uvX: [number, number] = [pc.z + 0.5, pc.y + 0.5];
    const uvY: [number, number] = [pc.x + 0.5, pc.z + 0.5];
    const uvZ: [number, number] = [pc.x + 0.5, pc.y + 0.5];

    let axis: 'x' | 'y' | 'z' = 'x';
    if (ny > nx && ny > nz) axis = 'y';
    else if (nz > nx && nz > ny) axis = 'z';

    const uvPick: [number, number] = axis === 'x' ? uvX : axis === 'y' ? uvY : uvZ;
    const u = uvPick[0];
    const v = uvPick[1];

    uvs[2 * i] = u;
    uvs[2 * i + 1] = v;
  }

  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  (geo.attributes.uv as THREE.BufferAttribute).needsUpdate = true;
}

/**
 * ============================================================================
 * SCENE COMPONENT - Main 3D Scene with Model, Materials, and Lighting
 * ============================================================================
 * This is the core component that renders the 3D objects.
 * It handles:
 * - Loading and displaying 3D models (GLB files) or primitive shapes
 * - Applying and updating materials with textures
 * - Managing texture loading states
 * - Creating the floor with reflections
 * - Setting up lighting (ambient + directional + point lights)
 * - Generating proper UV coordinates for texturing
 * 
 * The component is memoized to prevent unnecessary re-renders when
 * parent state changes that don't affect the scene.
 */
const Scene = memo(function Scene({
  meshIndex,
  params,
  envIntensity,
  safeMode,
  mapUrl,
  triScale,
  ctxVersion,
  onReady,
}: {
  meshIndex: number;
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
  const [loadingGlb, setLoadingGlb] = useState(false);
  const readyNotifiedRef = useRef(false);
  const { invalidate } = useThree();

  // ticks when a GLB actually mounts so we can re-assign materials then
  const [glbMountTick, setGlbMountTick] = useState(0);

  /* -------- Texture loading -------- */
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  const [loadingTex, setLoadingTex] = useState(false);
  const lastMapRef = useRef<string | undefined>(undefined);

  const whiteTex = React.useMemo(() => {
    const data = new Uint8Array([255, 255, 255, 255]);
    const t = new THREE.DataTexture(data, 1, 1);
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  }, []);

  const applyTilingCentered = (t: THREE.Texture, scale: number) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.center.set(0.5, 0.5);
    t.repeat.set(scale, scale);
    t.offset.set(0, 0);
    t.needsUpdate = true;
  };

  useEffect(() => {
    if (!mapUrl) {
      lastMapRef.current = undefined;
      setLoadingTex(false);
      setTex(null);
      return;
    }
    if (lastMapRef.current === mapUrl) return;
    
    let alive = true;
    setLoadingTex(true);
    
    const loader = new THREE.TextureLoader();
    loader.load(
      mapUrl,
      (t) => {
        if (!alive) {
          t.dispose();
          return;
        }
        t.colorSpace = THREE.SRGBColorSpace;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        t.magFilter = THREE.LinearFilter;
        t.anisotropy = 16;
        applyTilingCentered(t, triScale);
        setTex(t);
        lastMapRef.current = mapUrl;
        setLoadingTex(false);
      },
      undefined,
      () => {
        if (alive) setLoadingTex(false);
      },
    );
    
    return () => {
      alive = false;
    };
  }, [mapUrl, triScale]);

  // Update tiling when triScale changes
  useEffect(() => {
    if (tex) applyTilingCentered(tex, triScale);
  }, [tex, triScale]);

  /* -------- GLB via useGLTF (no external loader) -------- */
  const isGLB = meshIndex < 5;
  const glbPath = isGLB ? (MESHES[meshIndex] as { glb: string }).glb : '';

  // Track GLB loading state
  useEffect(() => {
    if (isGLB) {
      setLoadingGlb(true);
      readyNotifiedRef.current = false;
    } else {
      setLoadingGlb(false);
      readyNotifiedRef.current = false;
    }
  }, [isGLB, meshIndex]);

  // Notify parent when scene is ready (model loaded, no texture loading)
  useEffect(() => {
    // Scene is ready when:
    // 1. Model is not loading (GLB loaded or primitive ready)
    // 2. Texture is not loading (either loaded or no texture)
    if (!loadingGlb && !loadingTex && !readyNotifiedRef.current) {
      readyNotifiedRef.current = true;
      onReady?.();
    }
  }, [loadingGlb, loadingTex, onReady]);

  /* -------- Shared material -------- */
  const sharedMatRef = useRef<THREE.MeshPhysicalMaterial | MaterialWithTri | null>(null);
  if (!sharedMatRef.current) {
    const m = new THREE.MeshPhysicalMaterial({
      ...params,
      color: params.color || '#ffffff',
      envMapIntensity: envIntensity,
    }) as THREE.MeshPhysicalMaterial;

    if (!IS_WEBGPU) {
      (m as MaterialWithTri).map = whiteTex;
      applyTriplanar(m as MaterialWithTri);
      (m as MaterialWithTri).userData.triUniforms!.triMap.value = whiteTex;
    } else {
      // For WebGPU, set initial texture if available
      if (tex) {
        m.map = tex;
      }
    }
    sharedMatRef.current = m;
  }

  /* -------- Material updates -------- */
  useEffect(() => {
    const m = sharedMatRef.current;
    if (!m) return;

    const EPS = 0.02;
    const transmission = (params.transmission ?? 0) > EPS ? (params.transmission as number) : 0;
    const thickness = (params.thickness ?? 0) > EPS ? (params.thickness as number) : 0;
    const clearcoat = (params.clearcoat ?? 0) > EPS ? (params.clearcoat as number) : 0;

    // Batch all updates together
    (m as THREE.MeshPhysicalMaterial).roughness = params.roughness ?? 0.5;
    (m as THREE.MeshPhysicalMaterial).metalness = params.metalness ?? 0;
    (m as THREE.MeshPhysicalMaterial).ior = params.ior ?? 1.5;
    (m as THREE.MeshPhysicalMaterial).transmission = transmission;
    (m as THREE.MeshPhysicalMaterial).thickness = thickness;
    (m as THREE.MeshPhysicalMaterial).clearcoat = clearcoat;
    (m as THREE.MeshPhysicalMaterial).clearcoatRoughness = params.clearcoatRoughness ?? 0;
    
    // Keep envMapIntensity constant
    if ((m as THREE.MeshPhysicalMaterial).envMapIntensity !== envIntensity) {
      (m as THREE.MeshPhysicalMaterial).envMapIntensity = envIntensity;
    }

    const hasTex = !!(mapUrl && tex);
    if (IS_WEBGPU) {
      (m as THREE.MeshPhysicalMaterial).map = hasTex ? tex! : null;
      if (hasTex) (m as THREE.MeshPhysicalMaterial).color.set('#ffffff');
      else if (params.color) (m as THREE.MeshPhysicalMaterial).color.set(params.color as string);
      (m as THREE.MeshPhysicalMaterial).needsUpdate = true;
    } else {
      const tri = (m as MaterialWithTri).userData.triUniforms!;
      tri.triMap.value = hasTex ? tex! : whiteTex;
      tri.triScale.value = triScale;
      if (mapUrl) (m as THREE.MeshPhysicalMaterial).color.set('#ffffff');
      else if (params.color) (m as THREE.MeshPhysicalMaterial).color.set(params.color as string);
    }

    // Trigger re-render with demand frameloop
    invalidate();
  }, [params, envIntensity, tex, mapUrl, whiteTex, triScale, invalidate]);

  /* -------- Assign material + generate centered UVs for WebGPU -------- */
  useEffect(() => {
        const root = (isGLB ? groupRef.current : meshRef.current) as THREE.Object3D | null;
        if (!root) return;
    
        const assign = () => {
          root.updateWorldMatrix(true, true);
    
          const box = new THREE.Box3().setFromObject(root);
          const pivotWS = new THREE.Vector3(); box.getCenter(pivotWS);
          const sizeWS = new THREE.Vector3();  box.getSize(sizeWS);
          const sizeRef = Math.max(sizeWS.x, sizeWS.y, sizeWS.z) || 1;
    
          if (!IS_WEBGPU && sharedMatRef.current) {
            (sharedMatRef.current as MaterialWithTri).userData.triUniforms!.triPivot.value.copy(pivotWS);
          }
    
          root.traverse((o) => {
            const maybeMesh = o as THREE.Mesh;
            if (maybeMesh.isMesh) {
              const mesh = maybeMesh as THREE.Mesh;
              mesh.castShadow = true;
              mesh.receiveShadow = true;
              mesh.material = sharedMatRef.current!;
              if (IS_WEBGPU) {
                boxProjectUVsCentered(mesh.geometry as THREE.BufferGeometry, mesh, pivotWS, sizeRef);
              }
            }
          });
        };
    
        // run now and once next frame (covers late-mounting GLB children)
        assign();
        const raf = requestAnimationFrame(assign);
        return () => cancelAnimationFrame(raf);
      }, [isGLB, glbPath, meshIndex, glbMountTick]);

  /* Primitives: indices 5..9 */
  const primitive = !isGLB &&
    (() => {
    switch (meshIndex) {
        case 5:
          return <sphereGeometry args={[1, 64, 64]} />;
        case 6:
          return <boxGeometry args={[1.5, 1.5, 1.5]} />;
        case 7:
          return <torusGeometry args={[1, 0.4, 32, 64]} />;
        case 8:
          return <coneGeometry args={[1, 2, 24]} />;
        case 9:
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
            <GlbNode
              path={glbPath}
              onReady={() => {
                setGlbMountTick((t) => t + 1);
                setLoadingGlb(false);
              }}
            />
          </Suspense>
        </group>
      ) : (
          <mesh
            ref={meshRef}
            position={[0, 0, 0]}
            castShadow
            key={`prim-${meshIndex}-${ctxVersion}`}
          >
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

      {/* 
        FLOOR PLANE 
        - Large circular plane positioned below the model
        - Receives shadows from the model
        - Simple metallic material for best performance
        
        NOTE: Reflective floor (MeshReflectorMaterial) is disabled for performance.
        It was causing rendering issues and high GPU usage.
        Keeping it commented for future reference:
        
        <MeshReflectorMaterial
          key={`refl-${ctxVersion}`}
          mirror={0.08}
          metalness={1}
          roughness={0.55}
          color="#2a2438"
          resolution={1024}
          blur={[280, 100]}
          mixStrength={2.1}
          minDepthThreshold={0.8}
          maxDepthThreshold={1.2}
          depthScale={0.5}
        />
      */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.5, -0.3]} receiveShadow>
        <circleGeometry args={[10, 64]} />
        <meshPhysicalMaterial color="#2a2438" metalness={1} roughness={0.55} />
        
      </mesh>

      {/* 
        LIGHTING SETUP 
        Three-point lighting for good visibility and depth perception
      */}
      
      {/* Ambient light - provides base illumination from all directions */}
      <ambientLight intensity={0.3} />
      
      {/* 
        Directional light - simulates sunlight
        - Main light source creating shadows
        - Positioned above and to the side for dramatic lighting
        - Shadow camera settings define the shadow map coverage area
      */}
      <directionalLight
        position={[8, 10, 6]}
        intensity={1.0}
        castShadow={!safeMode}
        shadow-mapSize-width={safeMode ? 512 : 256}
        shadow-mapSize-height={safeMode ? 512 : 256}
        shadow-camera-far={20}
        shadow-camera-left={-10}
        shadow-camera-right={10}
        shadow-camera-top={10}
        shadow-camera-bottom={-10}
        shadow-bias={-0.0001}
      />
      
      {/* Point light - fill light from below to reduce harsh shadows */}
      <pointLight position={[-10, -10, -5]} intensity={0.25} />
    </>
  );
});

/**
 * ============================================================================
 * THREECANVAS - ROOT COMPONENT
 * ============================================================================
 * This is the main exported component that sets up the entire 3D viewer.
 * 
 * Features:
 * - WebGPU support with automatic fallback to WebGL
 * - Interactive 3D model viewer with orbit controls
 * - Material editor with real-time updates
 * - Texture support with loading indicators
 * - Responsive UI with mobile drawer
 * - Context loss recovery (safe mode)
 * - Performance optimizations (memoization, caching)
 * 
 * Architecture:
 * - Canvas: React Three Fiber's root component for 3D rendering
 * - Scene: Contains the 3D model, floor, and lighting
 * - Environment: Provides HDR lighting and background
 * - OrbitControls: Camera control for viewing the model
 * - UI Panel: Material and mesh selection interface
 */
export function ThreeCanvas() {
  // ========== STATE MANAGEMENT ==========
  
  // Currently selected mesh and material indices
  const [meshIndex, setMeshIndex] = useState(0);
  const [matIndex, setMatIndex] = useState(0);
  
  // Material parameters (roughness, metalness, transmission, etc.)
  const [params, setParams] = useState<THREE.MeshPhysicalMaterialParameters & { color?: string }>(
    MATERIALS[0].base as THREE.MeshPhysicalMaterialParameters & { color?: string },
  );
  
  // Canvas ref for touch scroll prevention
  const canvasRef = useRef<HTMLDivElement>(null);
  
  // Current texture URL (if the selected material has one)
  const currentMapUrl = (MATERIALS[matIndex] as { mapUrl?: string }).mapUrl;

  // Texture scaling/tiling factor
  const [texScale, setTexScale] = useState(0.56);

  // ========== RENDERING SETTINGS (CONSTANT) ==========
  // These values never change, so we use useMemo to prevent re-renders
  const exposure = React.useMemo(() => 0.62, []);        // Overall scene brightness
  const envIntensity = React.useMemo(() => 0.6, []);     // Environment map reflection strength
  const bgIntensity = React.useMemo(() => 1.0, []);      // Background brightness
  const bgBlur = React.useMemo(() => 0.8, []);           // Background blur amount
  
  // Safe mode: enabled after WebGL context loss, reduces quality to prevent further issues
  const [safeMode, setSafeMode] = useState(false);
  
  // Context version: incremented after context loss to force re-creation of resources
  const [ctxVersion, setCtxVersion] = useState(0);

  // ========== UI STATE ==========
  const [panelOpen, setPanelOpen] = useState(false);     // Mobile drawer open/closed
  const [sceneReady, setSceneReady] = useState(false);   // Track when initial scene is loaded

  // ========== DERIVED STATE ==========
  // Check if current material is glass (for showing/hiding relevant controls)
  const isGlass = (params.transmission ?? 0) > 0.01;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPanelOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ========== DISABLE TOUCH SCROLL IN FIRST SECTION (MOBILE ONLY) ==========
  // On mobile, completely prevent scroll in the first section (3D viewer only)
  // Other sections scroll normally
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Check if we're in the first section (hero with 3D canvas)
    const isInFirstSection = () => {
      const heroSection = document.getElementById('hero');
      if (!heroSection) return false;
      
      const rect = heroSection.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      
      // First section is visible if it occupies significant viewport
      return rect.top > -viewportHeight * 0.3 && rect.bottom > viewportHeight * 0.7;
    };

    const handleTouchMove = (e: TouchEvent) => {
      // Don't prevent if touch is on UI controls (sliders, buttons, selects)
      const target = e.target as HTMLElement;
      if (target.closest('.ui-range, .ui-select, .ui-button, input, select, button, [data-no-snap]')) {
        return; // Allow normal interaction with UI elements
      }

      // Completely prevent scroll in first section on mobile (for canvas area only)
      if (isInFirstSection()) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    // Use passive: false to allow preventDefault
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

  useEffect(() => {
    gsap.to({}, { duration: 0.25 });
  }, [meshIndex, matIndex]);

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
          dpr={safeMode ? 1 : Math.min(window.devicePixelRatio, 1.5)}
          frameloop="demand"
          // r3f accepts a Promise here at runtime
          // @ts-expect-error - async renderer factory is supported by r3f
          gl={(canvas: HTMLCanvasElement) => {
            if (IS_WEBGPU) {
              return (async () => {
                const WebGPURenderer = await loadWebGPURenderer();
                if (WebGPURenderer) {
                  console.log('✅ WebGPU Renderer loaded successfully');
                  const r = new WebGPURenderer({ canvas, antialias: !safeMode });
                  if (typeof r.init === 'function') await r.init();
                  // r3f accepts a WebGPURenderer as well; cast keeps TS calm
                  return r as unknown as THREE.WebGLRenderer;
                }
                console.log('⚠️ WebGPU not available, falling back to WebGL');
                return new THREE.WebGLRenderer({
                  canvas,
                  antialias: !safeMode,
                  alpha: false,
                  powerPreference: 'high-performance',
                  stencil: false,
                  depth: true,
                });
              })();
            }
            console.log('Using WebGL Renderer');
            return new THREE.WebGLRenderer({
              canvas,
              antialias: !safeMode,
              alpha: false,
              powerPreference: 'high-performance',
              stencil: false,
              depth: true,
            });
          }}
          camera={{ position: [0, 0, 4], fov: 50, near: 0.1, far: 100 }}
          performance={{ min: 0.5, max: 1, debounce: 50 }}
          onCreated={(state) => {
            const gl = state.gl as unknown as THREE.WebGLRenderer;
            const scene = state.scene as THREE.Scene;
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.outputColorSpace = THREE.SRGBColorSpace;
            if (!IS_WEBGPU) gl.setClearColor(0x000000, 0);
            const s = scene as SceneWithBg;
            s.backgroundIntensity = 1;
            s.backgroundBlurriness = 1;
          }}
        >
          <FrameInvalidator />
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

          {/* Environment using local HDR file */}
          <Environment 
            key={`env-${ctxVersion}`}
            files="/sunset.hdr"
            background
            blur={bgBlur}
          />

          <Suspense fallback={null}>
            <Scene
              meshIndex={meshIndex}
              params={params}
              envIntensity={envIntensity}
              safeMode={safeMode}
              mapUrl={currentMapUrl}
              triScale={texScale}
              ctxVersion={ctxVersion}
              onReady={() => setSceneReady(true)}
            />
            <Preload all />
          </Suspense>

          <SmartOrbitControls />
        </Canvas>

      {/* 
        UI CONTROLS - Only shown after scene is ready
        Prevents flickering during initial load
      */}
      {sceneReady && (
        <>
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

          {/* Backdrop overlay for mobile drawer */}
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
              lg:absolute lg:right-12 lg:top-24 lg:max-h-[calc(100svh-8rem)] lg:translate-x-0
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

        {/* Material */}
        <div className="flex items-center justify-between gap-2 mt-2">
          <label htmlFor="mat" className="text-xs opacity-80">
            Material
          </label>
          <select id="mat" className="ui-select" value={matIndex} onChange={(e) => setMatIndex(Number(e.target.value))}>
            {MATERIALS.map((m, i) => (
              <option key={m.name} value={i}>
                {m.name}
              </option>
            ))}
          </select>
        </div>

        {/* Controls */}
        <div className="mt-3 mb-2 space-y-2">
          {!currentMapUrl && (
            <Color label="Albedo" value={(params.color as string) || '#ffffff'} onChange={(hex) => setParams((p) => ({ ...p, color: hex }))} />
          )}
          {currentMapUrl && <Slider label="Texture Scale" min={0.3} max={3} step={0.01} value={texScale} onChange={setTexScale} />}
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

/* ---- Preload Mother Earth + first texture aggressively ---- */
try { useGLTF.preload('/glb1.glb'); } catch {}
// keep your other preloads if you want them:
[2, 3, 4, 5].forEach((n) => { try { useGLTF.preload(`/glb${n}.glb`); } catch {} });

// Warm up the first texture used by default (Texture 1) so it’s ready on first frame
const _prewarmTex = (() => {
  let started = false;
  return () => {
    if (started) return;
    started = true;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.src = '/texture1.jpg';
    // No onload needed; the browser will cache it for TextureLoader.
  };
})();
_prewarmTex();
