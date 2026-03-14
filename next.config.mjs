import pkg from './package.json' with { type: 'json' };
import { readFileSync, existsSync } from 'fs';

// Load AUTH_SECRET from persistent file if not already set in environment.
// This ensures the secret is available to Edge Runtime middleware on server
// restarts after the initial setup.
if (!process.env.AUTH_SECRET) {
  try {
    const authSecretPath = './data/auth_secret';
    if (existsSync(authSecretPath)) {
      const secret = readFileSync(authSecretPath, 'utf8').trim();
      if (secret) {
        process.env.AUTH_SECRET = secret;
      }
    }
  } catch {
    // File not accessible; AUTH_SECRET must be provided via environment variable
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [
        { 'better-sqlite3': 'commonjs better-sqlite3' },
        ...(Array.isArray(config.externals) ? config.externals : []),
      ];
    }
    return config;
  },
  images: {
    remotePatterns: [
      {
        hostname: 's2.googleusercontent.com',
      },
    ],
  },
  serverExternalPackages: [
    'pdf-parse',
    'better-sqlite3',
    '@huggingface/transformers',
    'onnxruntime-node',
  ],
  outputFileTracingExcludes: {
    '*': [
      './node_modules/onnxruntime-node/**',
      './node_modules/@img/**',
    ],
  },
  outputFileTracingIncludes: {
    '/api/**': [
      './node_modules/@napi-rs/canvas/**',
      './node_modules/@napi-rs/canvas-linux-x64-gnu/**',
      './node_modules/@napi-rs/canvas-linux-x64-musl/**',
    ],
  },
  env: {
    NEXT_PUBLIC_VERSION: pkg.version,
  },
};

export default nextConfig;
