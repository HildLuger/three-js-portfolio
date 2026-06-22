// ============================================================================
// POST-PROCESSING (WebGPU / TSL): Bloom + Lens flare
// ============================================================================
// Lightweight post stack for the hero scene: renders the beauty pass, then
// adds bloom and a bloom-derived lens flare. This component OWNS the render
// loop (useFrame with positive priority), so it must only mount when the
// active renderer is WebGPURenderer and safeMode is off.
//
// Heavy three/webgpu + three/tsl modules are imported dynamically so they never
// run during SSR / the Next build.

'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import type * as THREE from 'three';

export interface PostFXProps {
  /** When false, renders the plain beauty pass but still owns the loop. */
  enabled?: boolean;

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

  /** Max rendered FPS (0 = uncapped). */
  maxFps?: number;
}

export default function PostFX({
  enabled = true,
  bloom: useBloom = true,
  bloomStrength = 0.08,
  bloomRadius = 0.3,
  bloomThreshold = 1.0,
  lensflare: useLensflare = true,
  lensflareThreshold = 0.4,
  lensflareGhostSamples = 4,
  lensflareGhostSpacing = 0.25,
  lensflareAttenuation = 25,
  lensflareStrength = 3,
  maxFps = 60,
}: PostFXProps) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);

  const ppRef = useRef<{
    postProcessing: { render: () => void; dispose?: () => void };
  } | null>(null);

  useEffect(() => {
    let disposed = false;
    let postProcessing: { render: () => void; dispose?: () => void } | null = null;

    async function build() {
      const [webgpu, tsl, bloomMod, lensflareMod] = await Promise.all([
        import('three/webgpu'),
        import('three/tsl'),
        import('three/addons/tsl/display/BloomNode.js'),
        import('three/addons/tsl/display/LensflareNode.js'),
      ]);
      if (disposed) return;

      const { PostProcessing } = webgpu as unknown as {
        PostProcessing: new (renderer: THREE.WebGLRenderer) => {
          render: () => void;
          dispose?: () => void;
          outputNode: unknown;
          needsUpdate: boolean;
        };
      };
      const {
        pass,
        vec3,
        add,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } = tsl as unknown as Record<string, (...args: unknown[]) => any>;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { bloom } = bloomMod as { bloom: (...args: unknown[]) => any };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { lensflare } = lensflareMod as { lensflare: (...args: unknown[]) => any };

      const pp = new PostProcessing(gl as unknown as THREE.WebGLRenderer);
      const scenePass = pass(scene, camera);
      const scenePassColor = scenePass.getTextureNode('output');

      let outputNode = scenePassColor;

      if (enabled && (useBloom || useLensflare)) {
        const bloomPass = bloom(scenePassColor, bloomStrength, bloomRadius, bloomThreshold);
        outputNode = add(scenePassColor, bloomPass);

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
      ppRef.current = { postProcessing: pp };
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
  }, [
    gl,
    scene,
    camera,
    enabled,
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
      (gl as unknown as { render: (s: unknown, c: unknown) => void }).render(scene, camera);
    }
  }, 1);

  return null;
}
