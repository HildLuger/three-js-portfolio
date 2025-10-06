// Enable CommonJS `require` inside ESM next.config.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    // Force a single copy of three in the bundle
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      three: require.resolve('three'),
    };
    
    // Configure externals for server-side rendering
    if (isServer) {
      config.externals = [...(config.externals || []), { canvas: 'canvas' }];
    }
    
    return config;
  },
  // Transpile three.js modules
  transpilePackages: ['three'],
};

export default nextConfig;