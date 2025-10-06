declare module 'three/webgpu' {
  import type * as THREE from 'three';
  
  export class WebGPURenderer {
    constructor(options: { canvas: HTMLCanvasElement; antialias?: boolean });
    init(): Promise<void>;
    render(scene: THREE.Scene, camera: THREE.Camera): void;
    setSize(width: number, height: number): void;
    dispose(): void;
    domElement: HTMLCanvasElement;
    toneMapping: number;
    outputColorSpace: string;
    toneMappingExposure: number;
    setClearColor?: (color: number, alpha: number) => void;
  }
}

