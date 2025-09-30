import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Recommended for modern Next.js to speed up builds & use new compiler
  experimental: {
    turbo: {
      // Use Turbopack instead of Webpack (optional, depends on project)
      resolveAlias: {
        "@": "./src", // Example: set up a shortcut alias if you use /src folder
      },
    },
  },

  // Customizable options
  eslint: {
    // Don’t block production builds on ESLint errors
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Don’t block production builds on TS errors (useful in CI/CD)
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
