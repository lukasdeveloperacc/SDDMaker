import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname ?? dirname(fileURLToPath(import.meta.url)),
});

const eslintConfig = [
  {
    ignores: ['.next/**', 'node_modules/**', 'data/**', 'test/fixtures/**', 'next-env.d.ts'],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
];

export default eslintConfig;
