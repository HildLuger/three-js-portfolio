'use client';

import * as React from 'react';
import type { CSSProperties } from 'react';
import { useRef, useEffect, useState, Suspense, memo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Environment, MeshReflectorMaterial, useGLTF, Html } from '@react-three/drei';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { WebGPURenderer } from 'three/webgpu';
import gsap from 'gsap';

const IS_WEBGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;

/* ---------- Context loss protector ---------- */
function ContextLossProtector({ onLost, onRestored }: { onLost?: () => void; onRestored?: () => void }) {
  const { gl } = useThree();
  useEffect(() => {
    const c = gl.domElement as HTMLCanvasElement;
    const handleLost = (e: Event) => { e.preventDefault(); onLost?.(); };
    const handleRestored = () => {
      gl.toneMapping = THREE.ACESFilmicToneMapping;
      gl.outputColorSpace = THREE.SRGBColorSpace;
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

/* ---- Global exposure ---- */
function Exposure({ value = 0.62 }: { value: number }) {
  const { gl } = useThree();
  useEffect(() => {
    const prev = gl.toneMappingExposure;
    gl.toneMappingExposure = value;
    return () => { gl.toneMappingExposure = prev; };
  }, [gl, value]);
  return null;
}

/* ---- Env intensity (reflections) ---- */
type SceneWithEnvIntensity = THREE.Scene & { environmentIntensity?: number };
function SceneEnvIntensity({ value = 0.6 }: { value?: number }) {
  const { scene } = useThree();
  useEffect(() => {
    const s = scene as SceneWithEnvIntensity;
    const prev = s.environmentIntensity;
    s.environmentIntensity = value;
    return () => { s.environmentIntensity = prev ?? 1; };
  }, [scene, value]);
  return null;
}

/* ---- Background tuning ---- */
type SceneWithBg = THREE.Scene & { backgroundIntensity?: number; backgroundBlurriness?: number };
function BackgroundTune({ intensity = 1, blur = 0.8 }: { intensity?: number; blur?: number }) {
  const { scene } = useThree();
  useEffect(() => {
    const s = scene as SceneWithBg;
    const pi = s.backgroundIntensity;
    const pb = s.backgroundBlurriness;
    s.backgroundIntensity = intensity;
    s.backgroundBlurriness = blur;
    return () => { s.backgroundIntensity = pi ?? 1; s.backgroundBlurriness = pb ?? 0; };
  }, [scene, intensity, blur]);
  return null;
}

/* ---- Catalog / Materials ---- */
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

const MATERIALS = [
  { name: 'Texture 1', base: { metalness: 0.0, roughness: 0.2, ior: 1.5, transmission: 0, thickness: 0, clearcoat: 0,   clearcoatRoughness: 0 }, mapUrl: '/texture1.jpg' },
  { name: 'Texture 2', base: { metalness: 0.2, roughness: 0.2, ior: 1.5, transmission: 0, thickness: 0, clearcoat: 0,   clearcoatRoughness: 0 }, mapUrl: '/texture2.jpg' },
  { name: 'Texture 3', base: { metalness: 0.0, roughness: 0.2, ior: 1.5, transmission: 0, thickness: 0, clearcoat: 0.1, clearcoatRoughness: 0.2 }, mapUrl: '/texture3.jpg' },
  { name: 'Texture 4', base: { metalness: 0.6, roughness: 0.2, ior: 1.5, transmission: 0, thickness: 0, clearcoat: 0.2, clearcoatRoughness: 0.3 }, mapUrl: '/texture4.jpg' },
  { name: 'Texture 5', base: { metalness: 0.0, roughness: 0.2, ior: 1.5, transmission: 0, thickness: 0, clearcoat: 0,   clearcoatRoughness: 0 }, mapUrl: '/texture5.jpg' },
  { name: 'Texture 6', base: { metalness: 0.0, roughness: 0.2, ior: 1.5, transmission: 0, thickness: 0, clearcoat: 0,   clearcoatRoughness: 0 }, mapUrl: '/texture6.jpg' },
  { name: 'Texture 7', base: { metalness: 0.0, roughness: 0.2, ior: 1.5, transmission: 0, thickness: 0, clearcoat: 0,   clearcoatRoughness: 0 }, mapUrl: '/texture7.jpg' },
  { name: 'Texture 8', base: { metalness: 0.0, roughness: 0.2, ior: 1.5, transmission: 0, thickness: 0, clearcoat: 0,   clearcoatRoughness: 0 }, mapUrl: '/texture8.jpg' },
  { name: 'Texture 9', base: { metalness: 0.0, roughness: 0.2, ior: 1.5, transmission: 0, thickness: 0, clearcoat: 0,   clearcoatRoughness: 0 }, mapUrl: '/texture9.jpg' },

  { name: 'Default', base: { color: '#8976b8', metalness: 0, roughness: 0.1, ior: 1.5, transmission: 0, thickness: 0, clearcoat: 0, clearcoatRoughness: 0 } },
  { name: 'Metal',   base: { color: '#c0c0c0', metalness: 1, roughness: 0.1, ior: 1.5, transmission: 0, thickness: 0, clearcoat: 0, clearcoatRoughness: 0 } },
  { name: 'Glass',   base: { color: '#ffffff', metalness: 0, roughness: 0.1, ior: 1.5, transmission: 1, thickness: 1, clearcoat: 0, clearcoatRoughness: 0 } },
  { name: 'Rough',   base: { color: '#8ec78f', metalness: 0, roughness: 0.9, ior: 1.5, transmission: 0, thickness: 0, clearcoat: 0, clearcoatRoughness: 0 } },
  { name: 'Chrome',  base: { color: '#ffffff', metalness: 1, roughness: 0.0, ior: 1.5, transmission: 0, thickness: 0, clearcoat: 0, clearcoatRoughness: 0 } },
];

/* ---------- WebGL triplanar (unchanged) ---------- */
type TriUniforms = {
    triMap:   { value: THREE.Texture | null };
    triScale: { value: number };
    triSharp: { value: number };
    triPivot: { value: THREE.Vector3 }; // world-space anchor
  };
type MaterialWithTri = THREE.MeshPhysicalMaterial & {
  userData: THREE.MeshPhysicalMaterial['userData'] & { triUniforms?: TriUniforms };
};
function applyTriplanar(material: MaterialWithTri) {
  material.userData.triUniforms ??= {
    triMap:   { value: null },
    triScale: { value: 1.0 },
    triSharp: { value: 2.0 },
    triPivot: { value: new THREE.Vector3() },
  };
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `
        #include <common>
        varying vec3 vWPos;
        varying vec3 vWNorm;
      `)
      .replace('#include <beginnormal_vertex>', `
        #include <beginnormal_vertex>
        vWNorm = normalize(mat3(modelMatrix) * objectNormal);
      `)
      .replace('#include <begin_vertex>', `
        #include <begin_vertex>
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
      `);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <map_pars_fragment>', `
        #include <map_pars_fragment>
        varying vec3 vWPos;
        varying vec3 vWNorm;
        uniform sampler2D triMap;
        uniform float triScale;
        uniform float triSharp;
        uniform vec3  triPivot; // center anchor
        vec3 triBlend(vec3 n) {
          vec3 an = abs(n);
          an = pow(an, vec3(triSharp));
          return an / (an.x + an.y + an.z + 1e-5);
        }
        vec4 triSample(vec3 p, vec3 n){
          // world coords centered on triPivot
          vec3 pc = (p - triPivot);
          vec3 an = abs(normalize(n));
          // Hard cubic projection (no blending), but anchor scaling to texture center.
          if (an.x > an.y && an.x > an.z) {
            // use fract( ... + 0.5 ) so the pivot always samples at UV (0.5, 0.5)
            vec2 uv = fract(pc.zy * triScale + 0.5); // X face (YZ)
            return texture2D(triMap, uv);
          } else if (an.y > an.z) {
            vec2 uv = fract(pc.xz * triScale + 0.5); // Y face (XZ)
            return texture2D(triMap, uv);
          } else {
            vec2 uv = fract(pc.xy * triScale + 0.5); // Z face (XY)
            return texture2D(triMap, uv);
          }
        }
      `)
      .replace('#include <map_fragment>', `
        vec4 sampledDiffuseColor = triSample(vWPos, vWNorm);
        diffuseColor *= sampledDiffuseColor;
      `);
    shader.uniforms.triMap   = material.userData.triUniforms!.triMap;
    shader.uniforms.triScale = material.userData.triUniforms!.triScale;
    shader.uniforms.triSharp = material.userData.triUniforms!.triSharp;
    shader.uniforms.triPivot = material.userData.triUniforms!.triPivot;
  };
  material.needsUpdate = true;
}

/* ---------- WebGPU path: centered box-projected UVs with feather ---------- */
 function boxProjectUVsCentered(
    geo: THREE.BufferGeometry,
    obj: THREE.Object3D,
    pivotWS: THREE.Vector3,
    sizeRef: number,
    feather = 0.18
  ) {
  if (!geo.attributes.position) return;

  if (!geo.attributes.normal) geo.computeVertexNormals();

  const pos = geo.attributes.position as THREE.BufferAttribute;
  const norm = geo.attributes.normal  as THREE.BufferAttribute;
  const nMat = new THREE.Matrix3().getNormalMatrix(obj.matrixWorld);

  const uvs = new Float32Array(pos.count * 2);

  for (let i = 0; i < pos.count; i++) {
    // world-space position & normal
    const wp = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(obj.matrixWorld);
    const wn = new THREE.Vector3(norm.getX(i), norm.getY(i), norm.getZ(i)).applyMatrix3(nMat).normalize();

    // normalize by a single model-wide size, anchor at pivot
    const pc = wp.sub(pivotWS).divideScalar(sizeRef); // ~[-0.5..0.5] range

        const nx = Math.abs(wn.x), ny = Math.abs(wn.y), nz = Math.abs(wn.z);
          // Planar projections into [0..1] (center anchored by +0.5)
          const uvX: [number, number] = [ pc.z + 0.5, pc.y + 0.5 ]; // YZ
          const uvY: [number, number] = [ pc.x + 0.5, pc.z + 0.5 ]; // XZ
          const uvZ: [number, number] = [ pc.x + 0.5, pc.y + 0.5 ]; // XY
    
              // Choose dominant axis only (no blending) — avoid .sort() to keep tuple types intact
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

/* ------------------------------ Scene ------------------------------ */
const Scene = memo(function Scene({
  meshIndex,
  params,
  envIntensity,
  safeMode,
  mapUrl,
  triScale,
  ctxVersion,
}: {
  meshIndex: number;
  params: THREE.MeshPhysicalMaterialParameters & { color?: string };
  envIntensity: number;
  safeMode: boolean;
  mapUrl?: string;
  triScale: number;
  ctxVersion: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const groupRef = useRef<THREE.Group>(null!);
  useFrame(() => {});

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
    // keep pattern expansion anchored to uv center
    t.offset.set(0, -0 * scale); 
    t.needsUpdate = true;
  };

  useEffect(() => {
    if (!mapUrl) { lastMapRef.current = undefined; setLoadingTex(false); setTex(null); return; }
    if (lastMapRef.current === mapUrl && tex) return;
    let alive = true;
    setLoadingTex(true);
    new THREE.TextureLoader().load(
      mapUrl,
      (t) => {
        if (!alive) return;
        t.colorSpace = THREE.SRGBColorSpace;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        t.magFilter = THREE.LinearFilter;
        t.anisotropy = 4;
        applyTilingCentered(t, triScale);
        setTex(t);
        lastMapRef.current = mapUrl;
        setLoadingTex(false);
      },
      undefined,
      () => { if (alive) setLoadingTex(false); }
    );
    return () => { alive = false; };
  }, [mapUrl, tex, triScale]);

  // Update tiling when scale changes
  useEffect(() => { if (tex) applyTilingCentered(tex, triScale); }, [tex, triScale]);

  /* -------- GLB loading -------- */
  const isGLB = meshIndex < 5;
  const glbPath = isGLB ? (MESHES[meshIndex] as { glb: string }).glb : '';
  const [gltfScene, setGltfScene] = useState<THREE.Object3D | null>(null);
  const [loadingGlb, setLoadingGlb] = useState(false);

  useEffect(() => {
    if (!isGLB) { setGltfScene(null); setLoadingGlb(false); return; }
    let alive = true;
    setLoadingGlb(true);
    new GLTFLoader().load(
      glbPath,
      (g: GLTF) => { if (!alive) return; setGltfScene(g.scene); setLoadingGlb(false); },
      undefined,
      () => { if (alive) setLoadingGlb(false); }
    );
    return () => { alive = false; };
  }, [isGLB, glbPath]);

  /* -------- Shared material -------- */
  const sharedMatRef = useRef<THREE.MeshPhysicalMaterial | MaterialWithTri | null>(null);
  if (!sharedMatRef.current) {
    const m = new THREE.MeshPhysicalMaterial({
      ...params,
      envMapIntensity: envIntensity,
    }) as THREE.MeshPhysicalMaterial;

    if (!IS_WEBGPU) {
      (m as MaterialWithTri).map = whiteTex;
      applyTriplanar(m as MaterialWithTri);
      (m as MaterialWithTri).userData.triUniforms!.triMap.value = whiteTex;
    }
    sharedMatRef.current = m;
  }

  /* -------- Material updates -------- */
  const rafRef = useRef<number | null>(null);
  const lastApplied = useRef<Partial<THREE.MeshPhysicalMaterialParameters>>({});
  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const m = sharedMatRef.current!;
      const EPS = 0.02;
      const transmission = (params.transmission ?? 0) > EPS ? (params.transmission as number) : 0;
      const thickness    = (params.thickness ?? 0)    > EPS ? (params.thickness as number)    : 0;
      const clearcoat    = (params.clearcoat ?? 0)    > EPS ? (params.clearcoat as number)    : 0;

           const applyIfChanged = <K extends keyof THREE.MeshPhysicalMaterialParameters>(
                key: K,
                val: THREE.MeshPhysicalMaterialParameters[K]
              ) => {
                if (lastApplied.current[key] !== val) {
                  const mm = m as unknown as Record<string, unknown>;
                  mm[key as string] = val as unknown;
                  lastApplied.current[key] = val;
                }
              };

      applyIfChanged('roughness', params.roughness ?? 0.5);
      applyIfChanged('metalness', params.metalness ?? 0);
      applyIfChanged('ior',       params.ior ?? 1.5);
      applyIfChanged('transmission', transmission);
      applyIfChanged('thickness',    thickness);
      applyIfChanged('clearcoat',    clearcoat);
      applyIfChanged('clearcoatRoughness', params.clearcoatRoughness ?? 0);
      (m as THREE.MeshPhysicalMaterial).envMapIntensity = envIntensity;

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

      rafRef.current = null;
    });
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); rafRef.current = null; };
  }, [params, envIntensity, tex, mapUrl, whiteTex, triScale]);

  /* -------- Assign material + generate centered UVs for WebGPU -------- */
  useEffect(() => {
    const root = (isGLB ? groupRef.current : meshRef.current) as THREE.Object3D | null;
    if (!root) return;

   
      // Ensure world matrices are up to date, then compute pivot/size in WORLD space
      root.updateWorldMatrix(true, true);
      const box = new THREE.Box3().setFromObject(root);
    const pivotWS = new THREE.Vector3(); box.getCenter(pivotWS);
    const sizeWS  = new THREE.Vector3(); box.getSize(sizeWS);
    const sizeRef = Math.max(sizeWS.x, sizeWS.y, sizeWS.z) || 1;

    // Also push the pivot to the WebGL triplanar path
    if (!IS_WEBGPU && sharedMatRef.current) {
      (sharedMatRef.current as MaterialWithTri).userData.triUniforms!.triPivot.value.copy(pivotWS);
    }

      root.traverse((o) => {
            if ((o as THREE.Mesh).isMesh) {
              const mesh = o as THREE.Mesh;
              mesh.castShadow = true;
              mesh.receiveShadow = true;
              mesh.material = sharedMatRef.current!;
              if (IS_WEBGPU) {
                boxProjectUVsCentered(mesh.geometry as THREE.BufferGeometry, mesh, pivotWS, sizeRef, 0.18);
              }
            }
          });
  }, [isGLB, gltfScene, meshIndex]);

  // Primitives are indices 5..9
  const primitive = !isGLB && (() => {
    switch (meshIndex) {
      case 5: return <sphereGeometry args={[1, 64, 64]} />;
      case 6: return <boxGeometry args={[1.5, 1.5, 1.5]} />;
      case 7: return <torusGeometry args={[1, 0.4, 32, 64]} />;
      case 8: return <coneGeometry args={[1, 2, 24]} />;
      case 9: return <cylinderGeometry args={[1, 1, 2, 64]} />;
      default: return <sphereGeometry args={[1, 64, 64]} />;
    }
  })();

  return (
    <>
      {isGLB ? (
                 <group
                    ref={groupRef}
                    position={[0, 0, 0]}
                    key={`glb-${glbPath}-${ctxVersion}`}
                  >
          {gltfScene ? <primitive object={gltfScene} /> : (
            <mesh castShadow>
                <sphereGeometry key="fallback-sphere" args={[1, 64, 64]} />
              <primitive attach="material" object={sharedMatRef.current!} />
            </mesh>
          )}
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

      {(loadingGlb || loadingTex) && (
        <Html center>
          <div className="px-3 py-1 rounded bg-black/70 text-white text-sm pointer-events-none select-none">
            {loadingGlb ? 'loading mesh' : loadingTex ? 'loading texture' : null}
          </div>
        </Html>
      )}

      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.5, -0.3]} receiveShadow>
        <circleGeometry args={[10, 128]} />
        {IS_WEBGPU || safeMode ? (
          <meshPhysicalMaterial color="#2a2438" metalness={1} roughness={0.55} />
        ) : (
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
        )}
      </mesh>

      <ambientLight intensity={0.3} />
      <directionalLight
        position={[8, 10, 6]}
        intensity={1.0}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-far={40}
        shadow-camera-left={-15}
        shadow-camera-right={15}
        shadow-camera-top={15}
        shadow-camera-bottom={-15}
      />
      <pointLight position={[-10, -10, -5]} intensity={0.25} />
    </>
  );
});

/* --------------------------- Root component --------------------------- */
export function ThreeCanvas() {
  const [meshIndex, setMeshIndex] = useState(0);
  const [matIndex, setMatIndex] = useState(0);
  const [params, setParams] = useState<THREE.MeshPhysicalMaterialParameters & { color?: string }>(
    MATERIALS[0].base as THREE.MeshPhysicalMaterialParameters & { color?: string }
  );
  const currentMapUrl = (MATERIALS[matIndex] as { mapUrl?: string }).mapUrl;

  const [texScale, setTexScale] = useState(0.6);

  const [exposure] = useState(0.62);
  const [envIntensity] = useState(0.6);
  const [bgIntensity] = useState(1.0);
  const [bgBlur] = useState(0.8);
  const [safeMode, setSafeMode] = useState(false);
  const [ctxVersion, setCtxVersion] = useState(0);

  const [panelOpen, setPanelOpen] = useState(false);


    // Glass = has meaningful transmission
  const isGlass = (params.transmission ?? 0) > 0.01;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPanelOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
       setParams(prev => {
            const base = MATERIALS[matIndex].base as Partial<THREE.MeshPhysicalMaterialParameters & { color?: string }>;
            const next: THREE.MeshPhysicalMaterialParameters & { color?: string } = { ...prev, ...base };
            if (currentMapUrl) {
              delete (next as { color?: string }).color;
            }
            return next;
          });
  }, [matIndex, currentMapUrl]);

  useEffect(() => { gsap.to({}, { duration: 0.25 }); }, [meshIndex, matIndex]);

  const panelVars: CSSProperties & Record<'--panel-top' | '--panel-bottom', string> = {
    '--panel-top': 'calc(env(safe-area-inset-top) + 72px)',
    '--panel-bottom': 'calc(env(safe-area-inset-bottom) + 24px)',
  };

  return (
    <div className="w-full h-screen relative">
      <Suspense fallback={<div className="w-full h-full bg-black flex items-center justify-center">Loading 3D…</div>}>
        <Canvas
          shadows={!safeMode}
          style={{ touchAction: 'pan-y' }}
          className="w-full h-full"
          dpr={safeMode ? 1 : [1, 1.25]}
               gl={(canvas) => {
                  if (IS_WEBGPU) {
                    const r = new WebGPURenderer({ canvas, antialias: !safeMode }) as unknown as THREE.WebGLRenderer;
                    return r;
                  }
                  return new THREE.WebGLRenderer({ canvas, antialias: !safeMode, alpha: false, powerPreference: 'high-performance' });
                }}
          camera={{ position: [0, 0, 4], fov: 50, near: 0.1, far: 100 }}
          performance={{ min: 0.5 }}
          onCreated={({ gl, scene }) => {
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.outputColorSpace = THREE.SRGBColorSpace;
            if (!IS_WEBGPU) (gl as THREE.WebGLRenderer).setClearColor(0x000000, 0);
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
            onRestored={() => { setCtxVersion(v => v + 1); setSafeMode(false); }}
          />

          <Suspense fallback={null}>
            <Environment
              key={`env-${ctxVersion}`}
              preset="sunset"
              background
              frames={1}
              resolution={safeMode ? 128 : 256}
              blur={bgBlur}
            />
          </Suspense>

          <Scene
            meshIndex={meshIndex}
            params={params}
            envIntensity={envIntensity}
            safeMode={safeMode}
            mapUrl={currentMapUrl}
            triScale={texScale}
            ctxVersion={ctxVersion}
          />

          <OrbitControls
            enableDamping
            dampingFactor={0.05}
            enablePan={false}
            enableZoom={false}
            autoRotate
            autoRotateSpeed={0.5}
            target={[0, 0, 0]}
            minAzimuthAngle={-Infinity}
            maxAzimuthAngle={Infinity}
            minPolarAngle={0}
            maxPolarAngle={Math.PI / 2 - 0.001}
            makeDefault
          />
        </Canvas>
      </Suspense>

      {/* Hamburger button */}
      <button
        type="button"
        aria-label="Toggle controls"
        aria-expanded={panelOpen}
        onClick={() => setPanelOpen(v => !v)}
        className="fixed z-[65] right-4
                   top-[calc(env(safe-area-inset-top)+64px)]
                   lg:top-24
                   rounded-full px-3 py-2 bg-violet-400/80 text-white shadow-lg backdrop-blur
                   hover:bg-purple-500/90 focus:outline-none focus:ring-2 focus:ring-purple-400/50
                   lg:hidden"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>

      {panelOpen && (
        <button aria-label="Close controls" onClick={() => setPanelOpen(false)} className="fixed inset-0 z-[55] bg-black/40 backdrop-blur-sm lg:hidden" />
      )}

      {/* Drawer */}
      <div
        role="dialog" aria-modal="true" style={panelVars}
        className={`
          ui-card z-[60] p-3 pointer-events-auto
          fixed right-4 w-[min(320px,92vw)]
          top-[var(--panel-top)]
          max-h-[calc(100svh-var(--panel-top)-var(--panel-bottom))]
          overflow-y-auto overscroll-contain
          transform transition-transform duration-300 ease-out
          ${panelOpen ? 'translate-x-0' : 'translate-x-[calc(100%+1rem)]'}
          lg:absolute lg:right-12 lg:top-24 lg:max-h-[calc(100svh-8rem)] lg:translate-x-0
        `}
      >
        {/* Mesh */}
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="mesh" className="text-xs opacity-80">Mesh</label>
          <select id="mesh" className="ui-select" value={meshIndex} onChange={(e) => setMeshIndex(Number(e.target.value))}>
            {MESHES.map((m, i) => (<option key={m.name} value={i}>{m.name}</option>))}
          </select>
        </div>

        {/* Material */}
        <div className="flex items-center justify-between gap-2 mt-2">
          <label htmlFor="mat" className="text-xs opacity-80">Material</label>
          <select id="mat" className="ui-select" value={matIndex} onChange={(e) => setMatIndex(Number(e.target.value))}>
            {MATERIALS.map((m, i) => (<option key={m.name} value={i}>{m.name}</option>))}
          </select>
        </div>

        {/* Controls */}
        <div className="mt-3 mb-2 space-y-2">
          {!currentMapUrl && (
            <Color
              label="Albedo"
              value={(params.color as string) || '#ffffff'}
              onChange={(hex) => setParams((p) => ({ ...p, color: hex }))}
            />
          )}
          {currentMapUrl && (
            <Slider label="Texture Scale" min={0.1} max={2} step={0.01} value={texScale} onChange={setTexScale} />
          )}
          <Slider label="Roughness"    min={0}   max={1}     step={0.01}  value={params.roughness ?? 0.5}               onChange={(v) => setParams((p) => ({ ...p, roughness: v }))} />
          <Slider label="Metalness"    min={0}   max={1}     step={0.01}  value={params.metalness ?? 0}                 onChange={(v) => setParams((p) => ({ ...p, metalness: v }))} />
  {/* Glass-only controls */}
          {isGlass && (
            <>
              <Slider label="IOR"                min={1}   max={2.333} step={0.001}
                      value={params.ior ?? 1.5}
                      onChange={(v) => setParams((p) => ({ ...p, ior: v }))} />
              <Slider label="Transmission"       min={0}   max={1}     step={0.01}
                      value={params.transmission ?? 0}
                      onChange={(v) => setParams((p) => ({ ...p, transmission: v }))} />
              <Slider label="Thickness"          min={0}   max={2}     step={0.01}
                      value={params.thickness ?? 0}
                      onChange={(v) => setParams((p) => ({ ...p, thickness: v }))} />
            </>
          )}
          {/* Non-glass: clearcoat controls */}
          {!isGlass && (
            <>
              <Slider label="Clearcoat"                  min={0}   max={1}     step={0.01}
                      value={params.clearcoat ?? 0}
                      onChange={(v) => setParams((p) => ({ ...p, clearcoat: v }))} />
              <Slider label="Clearcoat Roughness"        min={0}   max={1}     step={0.01}
                      value={params.clearcoatRoughness ?? 0}
                      onChange={(v) => setParams((p) => ({ ...p, clearcoatRoughness: v }))} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* --------------------------- Small UI helpers --------------------------- */
function Slider({ label, value, min, max, step, onChange }:{
  label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void;
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
function Color({ label, value, onChange }:{ label: string; value: string; onChange: (hex: string) => void; }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <label className="text-xs opacity-80">{label}</label>
      <input
        className="ui-select h-8 p-1 w-28"
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={`Select ${label} color`}
      />
    </div>
  );
}

/* ---- Optional: Preload GLBs ---- */
[1, 2, 3, 4, 5].forEach(n => { try { useGLTF.preload(`/glb${n}.glb`); } catch {} });


