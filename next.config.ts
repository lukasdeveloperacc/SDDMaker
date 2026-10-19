import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['node-pty'],
  outputFileTracingIncludes: {
    '/api/agents/**': [
      './node_modules/node-pty/lib/**/*',
      './node_modules/node-pty/build/Release/*',
      `./node_modules/node-pty/prebuilds/${process.platform}-${process.arch}/**/*`,
    ],
  },
};

export default config;
