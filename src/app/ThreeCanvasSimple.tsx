'use client';
import { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import gsap from 'gsap';

// Mesh data - 5 different meshes
const MESHES = [
  { name: 'Sphere' },
  { name: 'Box' },
  { name: 'Torus' },
  { name: 'Cone' },
  { name: 'Cylinder' },
];

// Material data - 5 different PBR materials (physical)
const MATERIALS = [
  {
    name: 'Default',
    base: {
      color: '#ffffff',
      metalness: 0.0,
      roughness: 0.5,
      ior: 1.5,
      transmission: 0.0,
      thickness: 0.0,
      clearcoat: 0.0,
      clearcoatRoughness: 0.0,
    },
  },
  {
    name: 'Metal',
    base: {
      color: '#c0c0c0',
      metalness: 1.0,
      roughness: 0.1,
      ior: 1.5,
      transmission: 0.0,
      thickness: 0.0,
      clearcoat: 0.0,
      clearcoatRoughness: 0.0,
    },
  },
  {
    name: 'Glass',
    base: {
      color: '#ffffff',
      metalness: 0.0,
      roughness: 0.0,
      ior: 1.5,
      transmission: 1.0,
      thickness: 0.5,
      clearcoat: 0.0,
      clearcoatRoughness: 0.0,
    },
  },
  {
    name: 'Rough',
    base: {
      color: '#8b4513',
      metalness: 0.0,
      roughness: 0.9,
      ior: 1.5,
      transmission: 0.0,
      thickness: 0.0,
      clearcoat: 0.0,
      clearcoatRoughness: 0.0,
    },
  },
  {
    name: 'Chrome',
    base: {
      color: '#ffffff',
      metalness: 1.0,
      roughness: 0.0,
      ior: 1.5,
      transmission: 0.0,
      thickness: 0.0,
      clearcoat: 0.0,
      clearcoatRoughness: 0.0,
    },
  },
];

export function ThreeCanvasSimple() {
  const mountRef = useRef<HTMLDivElement>(null);

  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<any>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const floorRef = useRef<THREE.Mesh | null>(null);
  const skyRef = useRef<THREE.Object3D | null>(null);
  const sunDirLightRef = useRef<THREE.DirectionalLight | null>(null);
  const animationIdRef = useRef<number | null>(null);

  const pmremRef = useRef<THREE.PMREMGenerator | null>(null);
  const envRTRef = useRef<THREE.WebGLRenderTarget | null>(null);

  const [meshIndex, setMeshIndex] = useState(0);
  const [matIndex, setMatIndex] = useState(0);
  const [params, setParams] = useState(MATERIALS[0].base);

  useEffect(() => {
    if (!mountRef.current) return;

    const width = mountRef.current.clientWidth || window.innerWidth;
    const height = mountRef.current.clientHeight || window.innerHeight;

    // Scene
    const scene = new THREE.Scene();
    // Will show the Sky; start with neutral color during boot
    scene.background = new THREE.Color('#0a0a0a');
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
    camera.position.set(0, 0, 4);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.5; // << exposure from the screenshot
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Let page scroll; don’t hijack pinch/scroll
    renderer.domElement.style.touchAction = 'pan-y';

    // Guard against WebGL context loss
    renderer.domElement.addEventListener(
      'webglcontextlost',
      (e) => e.preventDefault(),
      { passive: false }
    );

    rendererRef.current = renderer;
    mountRef.current.appendChild(renderer.domElement);

    (async () => {
      const [{ OrbitControls }, { Sky }] = await Promise.all([
        import('three/examples/jsm/controls/OrbitControls.js'),
        import('three/examples/jsm/objects/Sky.js'),
      ]);

      // PMREM for env reflections
      const pmrem = new THREE.PMREMGenerator(renderer);
      pmrem.compileEquirectangularShader();
      pmremRef.current = pmrem;

      // OrbitControls: page scroll only; keep camera above ground
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.05;
      controls.enableZoom = false;
      controls.enablePan = false;
      controls.minAzimuthAngle = -Math.PI / 3;
      controls.maxAzimuthAngle =  Math.PI / 3;
      controls.minPolarAngle   =  Math.PI / 4;
      controls.maxPolarAngle   =  Math.PI / 2 - 0.01;
      controlsRef.current = controls;

      // --- Sky with your exact settings ---
      const sky = new Sky();
      sky.scale.setScalar(450000);
      scene.add(sky);
      skyRef.current = sky;

      const uniforms = (sky.material as THREE.ShaderMaterial).uniforms;
      uniforms['turbidity'].value = 8.9;
      uniforms['rayleigh'].value = 1.493;
      uniforms['mieCoefficient'].value = 0.0;
      uniforms['mieDirectionalG'].value = 1.0;

      // elevation 2.6°, azimuth 180°
      const elevation = 2.6;
      const azimuth = 180;
      const phiPolar = THREE.MathUtils.degToRad(90 - elevation);
      const theta = THREE.MathUtils.degToRad(azimuth);
      const sunPosition = new THREE.Vector3().setFromSphericalCoords(1, phiPolar, theta);
      uniforms['sunPosition'].value.copy(sunPosition);

      // Sun light aligned to the sky
      const sun = new THREE.DirectionalLight(0xffffff, 0.2);
      sun.position.copy(sunPosition).multiplyScalar(1000);
      sun.castShadow = true;
      sun.shadow.mapSize.set(1024, 1024);
      scene.add(sun);
      sunDirLightRef.current = sun;

      // Bake env map from the sky so PBR reflections match
      const skyScene = new THREE.Scene();
      skyScene.add(sky.clone());
      envRTRef.current = pmrem.fromScene(skyScene, 0.04);
      scene.environment = envRTRef.current.texture;

      // Ground
      const floor = new THREE.Mesh(
        new THREE.CircleGeometry(10, 64),
        new THREE.MeshStandardMaterial({ color: '#1a1a1a', roughness: 1, metalness: 0 })
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(0, -1.3, -0.3);
      floor.receiveShadow = true;
      scene.add(floor);
      floorRef.current = floor;

      // Subtle fill
      const ambient = new THREE.AmbientLight(0xffffff, 0.25);
      scene.add(ambient);

      const fill = new THREE.PointLight(0xffffff, 0.3);
      fill.position.set(-10, -10, -5);
      scene.add(fill);

      // Initial mesh
      createMesh();

      // Loop
      const animate = () => {
        animationIdRef.current = requestAnimationFrame(animate);
        if (meshRef.current) {
          meshRef.current.rotation.y += 0.005;
          meshRef.current.rotation.x += 0.002;
        }
        controls.update();
        renderer.render(scene, camera);
      };
      animate();
    })();

    // Resize
    const handleResize = () => {
      const w = mountRef.current?.clientWidth || window.innerWidth;
      const h = mountRef.current?.clientHeight || window.innerHeight;
      if (!camera || !renderer) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      if (animationIdRef.current) cancelAnimationFrame(animationIdRef.current);

      const scene = sceneRef.current;
      const renderer = rendererRef.current;

      if (renderer && renderer.domElement && mountRef.current) {
        mountRef.current.removeChild(renderer.domElement);
      }

      if (envRTRef.current) {
        envRTRef.current.dispose();
        envRTRef.current = null;
      }
      if (pmremRef.current) {
        pmremRef.current.dispose();
        pmremRef.current = null;
      }

      if (meshRef.current) {
        const m = meshRef.current.material as THREE.Material | THREE.Material[];
        if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
        else m.dispose();
        meshRef.current.geometry.dispose();
        scene?.remove(meshRef.current);
        meshRef.current = null;
      }
      if (floorRef.current) {
        (floorRef.current.material as THREE.Material).dispose();
        floorRef.current.geometry.dispose();
        scene?.remove(floorRef.current);
        floorRef.current = null;
      }
      if (skyRef.current) {
        const sky = skyRef.current as any;
        if (sky.material) (sky.material as THREE.Material).dispose?.();
        scene?.remove(skyRef.current);
        skyRef.current = null;
      }
      if (sunDirLightRef.current) {
        scene?.remove(sunDirLightRef.current);
        sunDirLightRef.current = null;
      }

      renderer?.dispose();
      scene?.clear();
      sceneRef.current = null;
      rendererRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
    };
  }, []); // run once

  // Create/replace mesh based on current selection
  const createMesh = () => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (meshRef.current) {
      scene.remove(meshRef.current);
      const oldMat = meshRef.current.material as THREE.Material | THREE.Material[];
      if (Array.isArray(oldMat)) oldMat.forEach((m) => m.dispose());
      else oldMat.dispose();
      meshRef.current.geometry.dispose();
    }

    let geometry: THREE.BufferGeometry;
    switch (meshIndex) {
      case 0: geometry = new THREE.SphereGeometry(1, 32, 32); break;
      case 1: geometry = new THREE.BoxGeometry(1.5, 1.5, 1.5); break;
      case 2: geometry = new THREE.TorusGeometry(1, 0.4, 16, 32); break;
      case 3: geometry = new THREE.ConeGeometry(1, 2, 24); break;
      case 4: geometry = new THREE.CylinderGeometry(1, 1, 2, 32); break;
      default: geometry = new THREE.SphereGeometry(1, 32, 32);
    }

    const material = new THREE.MeshPhysicalMaterial({
      color: params.color || '#ffffff',
      metalness: params.metalness ?? 0.0,
      roughness: params.roughness ?? 0.5,
      ior: params.ior ?? 1.5,
      transmission: params.transmission ?? 0.0,
      thickness: params.thickness ?? 0.0,
      clearcoat: (params as any).clearcoat ?? 0.0,
      clearcoatRoughness: (params as any).clearcoatRoughness ?? 0.0,
      envMapIntensity: 1.0,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = false;

    meshRef.current = mesh;
    scene.add(mesh);
  };

  // Update mesh when selection changes
  useEffect(() => {
    createMesh();
    gsap.to({}, { duration: 0.2 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meshIndex]);

  // Update material when parameters change
  useEffect(() => {
    if (!meshRef.current) return;
    const mat = meshRef.current.material;
    if (mat && mat instanceof THREE.MeshPhysicalMaterial) {
      mat.color.set(params.color || '#ffffff');
      mat.metalness = params.metalness ?? 0.0;
      mat.roughness = params.roughness ?? 0.5;
      mat.ior = params.ior ?? 1.5;
      mat.transmission = params.transmission ?? 0.0;
      mat.thickness = params.thickness ?? 0.0;
      (mat as any).clearcoat = (params as any).clearcoat ?? 0.0;
      (mat as any).clearcoatRoughness = (params as any).clearcoatRoughness ?? 0.0;
      mat.needsUpdate = true;
    }
  }, [params]);

  // Update params when switching base material
  useEffect(() => {
    setParams((prev) => ({ ...prev, ...MATERIALS[matIndex].base }));
  }, [matIndex]);

  return (
    <div className="w-full h-screen relative">
      <div ref={mountRef} className="w-full h-full" />

      {/* UI Panel */}
      <div className="absolute top-20 right-4 w-[min(360px,92vw)] space-y-3 ui-card">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="mesh-select" className="text-sm opacity-80">Mesh</label>
          <select
            id="mesh-select"
            className="ui-select"
            value={meshIndex}
            onChange={(e) => setMeshIndex(Number(e.target.value))}
            aria-label="Select mesh type"
          >
            {MESHES.map((m, i) => (
              <option key={m.name} value={i}>{m.name}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center justify-between gap-2">
          <label htmlFor="material-select" className="text-sm opacity-80">Material</label>
          <select
            id="material-select"
            className="ui-select"
            value={matIndex}
            onChange={(e) => setMatIndex(Number(e.target.value))}
            aria-label="Select material type"
          >
            {MATERIALS.map((m, i) => (
              <option key={m.name} value={i}>{m.name}</option>
            ))}
          </select>
        </div>

        {/* Tunable parameters (core PBR) */}
        <Slider
          label="Metalness"
          min={0}
          max={1}
          step={0.01}
          value={params.metalness ?? 0}
          onChange={(v) => setParams((p) => ({ ...p, metalness: v }))}
        />
        <Slider
          label="Roughness"
          min={0}
          max={1}
          step={0.01}
          value={params.roughness ?? 0.5}
          onChange={(v) => setParams((p) => ({ ...p, roughness: v }))}
        />
        <Slider
          label="IOR"
          min={1}
          max={2.333}
          step={0.001}
          value={params.ior ?? 1.5}
          onChange={(v) => setParams((p) => ({ ...p, ior: v }))}
        />
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
        <Slider
          label="Clearcoat"
          min={0}
          max={1}
          step={0.01}
          value={(params as any).clearcoat ?? 0}
          onChange={(v) => setParams((p) => ({ ...p, clearcoat: v }))}
        />
        <Slider
          label="Clearcoat Roughness"
          min={0}
          max={1}
          step={0.01}
          value={(params as any).clearcoatRoughness ?? 0}
          onChange={(v) => setParams((p) => ({ ...p, clearcoatRoughness: v }))}
        />
        <Color
          label="Albedo"
          value={params.color || '#ffffff'}
          onChange={(hex) => setParams((p) => ({ ...p, color: hex }))}
        />
      </div>
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
      <div className="flex justify-between text-xs mb-1">
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

function Color({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <label className="text-sm opacity-80">{label}</label>
      <input
        className="ui-select h-9 p-1 w-28"
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={`Select ${label} color`}
      />
    </div>
  );
}
