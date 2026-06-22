/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  eslint: {
    // Don't block production builds on ESLint errors
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
