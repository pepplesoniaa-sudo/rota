import path from 'node:path';
import type { NextConfig } from 'next';

const isLocalWindows = process.platform === 'win32' && !process.env.CI && !process.env.DOCKER_BUILD;

const nextConfig: NextConfig = {
  // Use standalone output for Docker containerization and CI.
  // On local Windows dev hosts without developer mode / admin privileges,
  // standalone file tracing fails on symlink creation (EPERM).
  output: isLocalWindows && process.env.STANDALONE !== 'true' ? undefined : 'standalone',
  outputFileTracingRoot: path.resolve(__dirname, '../../'),
  reactStrictMode: true,
};

export default nextConfig;
