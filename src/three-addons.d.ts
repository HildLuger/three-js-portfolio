// Ambient type declarations for the WebGPU/TSL example addons, which ship as
// plain .js in the three package without bundled .d.ts files.

declare module 'three/addons/objects/SkyMesh.js' {
  import { Mesh, Vector3 } from 'three/webgpu';

  // TSL uniform node: a thin wrapper exposing a mutable `.value`.
  interface UniformLike<T> {
    value: T;
  }

  export class SkyMesh extends Mesh {
    constructor();
    turbidity: UniformLike<number>;
    rayleigh: UniformLike<number>;
    mieCoefficient: UniformLike<number>;
    mieDirectionalG: UniformLike<number>;
    sunPosition: UniformLike<Vector3>;
    upUniform: UniformLike<Vector3>;
    cloudScale: UniformLike<number>;
    cloudSpeed: UniformLike<number>;
    cloudCoverage: UniformLike<number>;
    cloudDensity: UniformLike<number>;
    cloudElevation: UniformLike<number>;
    showSunDisc: UniformLike<number>;
    readonly isSkyMesh: boolean;
  }
}

declare module 'three/addons/objects/WaterMesh.js' {
  import { Mesh, Vector3, Color, BufferGeometry, Texture } from 'three/webgpu';

  interface UniformLike<T> {
    value: T;
  }

  export interface WaterMeshOptions {
    resolutionScale?: number;
    waterNormals?: Texture;
    alpha?: number;
    size?: number;
    sunColor?: number | string | Color;
    sunDirection?: Vector3;
    waterColor?: number | string | Color;
    distortionScale?: number;
  }

  export class WaterMesh extends Mesh {
    constructor(geometry: BufferGeometry, options?: WaterMeshOptions);
    resolutionScale: number;
    alpha: UniformLike<number>;
    size: UniformLike<number>;
    sunColor: UniformLike<Color>;
    sunDirection: UniformLike<Vector3>;
    waterColor: UniformLike<Color>;
    distortionScale: UniformLike<number>;
    readonly isWaterMesh: boolean;
  }
}
