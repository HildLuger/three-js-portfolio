// ============================================================================
// POST-PROCESSING (WebGPU / TSL): SSGI + Bloom + Lens flare
// ============================================================================
// Screen-Space Global Illumination, bloom and lens flare for the hero scene,
// built on three.js' native TSL display nodes. Renders the scene into an MRT
// pass (color + diffuse albedo + view normals + velocity), runs the `ssgi`
// node for indirect diffuse + AO, composites it back onto the beauty pass, then
// adds bloom and a bloom-derived lens flare.
//
// This component OWNS the render loop: useFrame with a positive priority makes
// R3F stop auto-rendering, and we drive PostProcessing.render() ourselves. It
// therefore must ONLY be mounted when:
//   - the active renderer is the node-based WebGPURenderer (not the WebGL2
//     fallback), and
//   - we are not in safeMode (context-loss / low-end degraded mode).
// The parent gates both of these before mounting.
//
// All heavy three/webgpu + three/tsl modules are imported dynamically so they
// never run during SSR / the Next build.

'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import type * as THREE from 'three';

export interface PostFXProps {
  /** When false, renders the plain beauty pass (SSGI bypassed) but still owns the loop. */
  enabled?: boolean;

  // --- SSGI ---
  /** Hemisphere slices per pixel [1..4]. Higher = less noise, more cost. */
  sliceCount?: number;
  /** Samples per slice side. Higher = more accurate, more cost. */
  stepCount?: number;
  /** Indirect diffuse light intensity. */
  giIntensity?: number;
  /** AO darkening power. */
  aoIntensity?: number;
  /** World-space sampling radius. */
  radius?: number;
  /** Fraction of drawing-buffer resolution for the GI buffer (0..1). 0.5 = quarter pixels. */
  resolutionScale?: number;
  /** Sample distribution exponent. */
  expFactor?: number;
  /** Constant object thickness in world units. */
  thickness?: number;
  /** How much light backface surfaces emit [0..1]. */
  backfaceLighting?: number;
  /** Sample in screen space instead of world space. */
  screenSpaceSampling?: boolean;
  /** Scale thickness linearly with distance. */
  linearThickness?: boolean;
  /** Temporal filtering (TRAA). */
  temporal?: boolean;
  /** Extra spatial denoise pass. */
  denoise?: boolean;
  denoiseRadius?: number;
  denoiseLumaPhi?: number;
  denoiseDepthPhi?: number;
  denoiseNormalPhi?: number;
  /** Max rendered FPS (0 = uncapped). Throttles the heavy pipeline. */
  maxFps?: number;

  // --- Bloom ---
  bloom?: boolean;
  bloomStrength?: number;
  bloomRadius?: number;
  /** Luminance threshold above which pixels bloom (pre-tonemap HDR values). */
  bloomThreshold?: number;

  // --- Lens flare (derived from the bloom buffer; requires bloom) ---
  lensflare?: boolean;
  lensflareThreshold?: number;
  lensflareGhostSamples?: number;
  lensflareGhostSpacing?: number;
  lensflareAttenuation?: number;
  lensflareStrength?: number;
}

export default function PostFX({
  enabled = true,
  // SSGI sample budget. Modest values keep mid-range GPUs happy; denoise cleans up.
  sliceCount = 2,
  stepCount = 16,
  // Render GI at half resolution (quarter of the pixels) — the biggest single win.
  resolutionScale = 1.0,
  giIntensity = 1,
  aoIntensity = 1.0,
  radius = 4,
  expFactor = 1.0,
  thickness = 1.75,
  backfaceLighting = 0.0,
  screenSpaceSampling = false,
  linearThickness = true,
  temporal = false,
  denoise: useDenoise = true,
  denoiseRadius = 8,
  denoiseLumaPhi = 10,
  denoiseDepthPhi = 5,
  denoiseNormalPhi = 3,
  maxFps = 60,
  // Bloom: the scene pass is HDR (tone mapping applied last), so a threshold near
  // 1 keeps bloom on the sun / sky highlights / bright specular.
  bloom: useBloom = true,
  bloomStrength = 0.08,
  bloomRadius = 0.3,
  bloomThreshold = 1.0,
  // Lens flare reuses bloom's bright buffer, so it's near-free on top of bloom.
  lensflare: useLensflare = true,
  lensflareThreshold = 0.4,
  lensflareGhostSamples = 4,
  lensflareGhostSpacing = 0.25,
  lensflareAttenuation = 25,
  lensflareStrength = 3,
}: PostFXProps) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);

  // Live PostProcessing instance + mutable uniform handles for cheap tuning.
  const ppRef = useRef<{
    postProcessing: { render: () => void; dispose?: () => void };
    giPass: {
      sliceCount: { value: number };
      stepCount: { value: number };
      giIntensity: { value: number };
      aoIntensity: { value: number };
      radius: { value: number };
    };
  } | null>(null);

  useEffect(() => {
    let disposed = false;
    let postProcessing: { render: () => void; dispose?: () => void } | null = null;

    async function build() {
      const [webgpu, tsl, ssgiMod, traaMod, denoiseMod, bloomMod, lensflareMod] = await Promise.all([
        import('three/webgpu'),
        import('three/tsl'),
        import('three/addons/tsl/display/SSGINode.js'),
        import('three/addons/tsl/display/TRAANode.js'),
        import('three/addons/tsl/display/DenoiseNode.js'),
        import('three/addons/tsl/display/BloomNode.js'),
        import('three/addons/tsl/display/LensflareNode.js'),
      ]);
      if (disposed) return;

      const { PostProcessing, HalfFloatType } = webgpu as unknown as {
        PostProcessing: new (renderer: THREE.WebGLRenderer) => {
          render: () => void;
          dispose?: () => void;
          outputNode: unknown;
          needsUpdate: boolean;
        };
        HalfFloatType: number;
      };
      const {
        pass,
        mrt,
        output,
        normalView,
        diffuseColor,
        velocity,
        add,
        vec3,
        vec4,
        directionToColor,
        colorToDirection,
        sample,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } = tsl as unknown as Record<string, (...args: unknown[]) => any>;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { ssgi } = ssgiMod as { ssgi: (...args: unknown[]) => any };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { traa } = traaMod as { traa: (...args: unknown[]) => any };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { denoise } = denoiseMod as { denoise: (...args: unknown[]) => any };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { bloom } = bloomMod as { bloom: (...args: unknown[]) => any };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { lensflare } = lensflareMod as { lensflare: (...args: unknown[]) => any };

      const pp = new PostProcessing(gl as unknown as THREE.WebGLRenderer);

      // Geometry buffer: beauty + albedo + packed view normals + motion vectors.
      const scenePass = pass(scene, camera);
      scenePass.setMRT(
        mrt({
          output,
          diffuseColor,
          normal: directionToColor(normalView),
          velocity,
        }),
      );

      // Store packed normals at half-float to avoid 8-bit quantization banding.
      const normalTexture = scenePass.getTexture('normal');
      normalTexture.type = HalfFloatType;

      const scenePassColor = scenePass.getTextureNode('output');
      const scenePassDiffuse = scenePass.getTextureNode('diffuseColor');
      const scenePassDepth = scenePass.getTextureNode('depth');
      const scenePassNormal = scenePass.getTextureNode('normal');
      const scenePassVelocity = scenePass.getTextureNode('velocity');

      // Unpack normals from [0,1] color encoding back to view-space directions.
      const sceneNormal = sample((uv: unknown) => colorToDirection(scenePassNormal.sample(uv)));

      let outputNode;

      if (!enabled) {
        outputNode = scenePassColor;
      } else {
        const giPass = ssgi(scenePassColor, scenePassDepth, sceneNormal, camera);
        giPass.sliceCount.value = sliceCount;
        giPass.stepCount.value = stepCount;
        giPass.giIntensity.value = giIntensity;
        giPass.aoIntensity.value = aoIntensity;
        giPass.radius.value = radius;
        giPass.expFactor.value = expFactor;
        giPass.thickness.value = thickness;
        giPass.backfaceLighting.value = backfaceLighting;
        giPass.useScreenSpaceSampling.value = screenSpaceSampling;
        giPass.useLinearThickness.value = linearThickness;
        giPass.useTemporalFiltering = temporal;

        // Half-resolution GI: wrap setSize so the GI render target is a fraction
        // of the drawing buffer, then bilinearly upscaled during the composite.
        if (resolutionScale > 0 && resolutionScale < 1) {
          const origSetSize = (giPass.setSize as (w: number, h: number) => void).bind(giPass);
          giPass.setSize = (w: number, h: number) =>
            origSetSize(
              Math.max(1, Math.round(w * resolutionScale)),
              Math.max(1, Math.round(h * resolutionScale)),
            );
        }

        ppRef.current = { postProcessing: pp, giPass };

        // Edge-aware spatial denoise of the GI/AO buffer.
        let resolved = giPass;
        if (useDenoise) {
          const dn = denoise(giPass.getTextureNode(), scenePassDepth, sceneNormal, camera);
          dn.radius.value = denoiseRadius;
          dn.lumaPhi.value = denoiseLumaPhi;
          dn.depthPhi.value = denoiseDepthPhi;
          dn.normalPhi.value = denoiseNormalPhi;
          resolved = dn;
        }

        const gi = resolved.rgb;
        const ao = resolved.a;

        // beauty * AO + albedo * GI (indirect diffuse with color bleeding).
        const composite = vec4(
          add(scenePassColor.rgb.mul(ao), scenePassDiffuse.rgb.mul(gi)),
          scenePassColor.a,
        );

        outputNode = temporal ? traa(composite, scenePassDepth, scenePassVelocity, camera) : composite;
      }

      // --- Bloom + lens flare (read the HDR beauty pass) ---
      if (useBloom || useLensflare) {
        const bloomPass = bloom(scenePassColor, bloomStrength, bloomRadius, bloomThreshold);
        outputNode = outputNode.add(bloomPass);

        if (useLensflare) {
          const lensPass = lensflare(bloomPass.getTextureNode(), {
            ghostTint: vec3(1.0, 0.92, 0.78),
            threshold: lensflareThreshold,
            ghostSamples: lensflareGhostSamples,
            ghostSpacing: lensflareGhostSpacing,
            ghostAttenuationFactor: lensflareAttenuation,
          });
          outputNode = outputNode.add(lensPass.mul(lensflareStrength));
        }
      }

      pp.outputNode = outputNode;
      pp.needsUpdate = true;

      postProcessing = pp;
      // Bypass path has no giPass; set a render-only handle so useFrame can draw.
      if (!ppRef.current) {
        ppRef.current = {
          postProcessing: pp,
          giPass: {
            sliceCount: { value: sliceCount },
            stepCount: { value: stepCount },
            giIntensity: { value: giIntensity },
            aoIntensity: { value: aoIntensity },
            radius: { value: radius },
          },
        };
      }
    }

    build().catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[PostFX] Failed to build pipeline:', err);
    });

    return () => {
      disposed = true;
      ppRef.current = null;
      postProcessing?.dispose?.();
    };
    // Scalar uniforms are applied live in the effect below; excluded on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    gl,
    scene,
    camera,
    enabled,
    temporal,
    useDenoise,
    resolutionScale,
    expFactor,
    thickness,
    backfaceLighting,
    screenSpaceSampling,
    linearThickness,
    denoiseRadius,
    denoiseLumaPhi,
    denoiseDepthPhi,
    denoiseNormalPhi,
    useBloom,
    bloomStrength,
    bloomRadius,
    bloomThreshold,
    useLensflare,
    lensflareThreshold,
    lensflareGhostSamples,
    lensflareGhostSpacing,
    lensflareAttenuation,
    lensflareStrength,
  ]);

  // Keep scalar uniforms in sync without rebuilding the graph.
  useEffect(() => {
    const handle = ppRef.current;
    if (!handle) return;
    handle.giPass.sliceCount.value = sliceCount;
    handle.giPass.stepCount.value = stepCount;
    handle.giPass.giIntensity.value = giIntensity;
    handle.giPass.aoIntensity.value = aoIntensity;
    handle.giPass.radius.value = radius;
  }, [sliceCount, stepCount, giIntensity, aoIntensity, radius]);

  const frameAccRef = useRef(0);

  // Positive priority => R3F stops auto-rendering and we drive the renderer.
  useFrame((_, delta) => {
    if (maxFps > 0) {
      frameAccRef.current += delta;
      const interval = 1 / maxFps;
      if (frameAccRef.current < interval) return;
      frameAccRef.current = Math.min(frameAccRef.current - interval, interval);
    }

    const handle = ppRef.current;
    if (handle) {
      handle.postProcessing.render();
    } else {
      // Pipeline still building: keep presenting frames with a plain render.
      (gl as unknown as { render: (s: unknown, c: unknown) => void }).render(scene, camera);
    }
  }, 1);

  return null;
}
