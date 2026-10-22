import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.expo/**',
      '**/coverage/**',
      '**/*.log',
      '**/apps/mobile/ios/**',
      '**/apps/mobile/android/**',
      '**/scratch/**',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-expect-error': 'allow-with-description' },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      'no-console': 'error',
      'no-empty': 'error',
    },
  },
  // CS-13: Ban hex color strings in mobile UI except in tokens
  {
    files: ['apps/mobile/**/*.{ts,tsx}'],
    ignores: ['apps/mobile/src/ui/tokens/**', 'apps/mobile/tests/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/^#[0-9a-fA-F]{3,8}$/]',
          message:
            'Hex color literals are banned in mobile UI per CS-13. Use theme tokens from src/ui instead.',
        },
      ],
      // CS-5: Mobile import boundaries (no node:, api, prisma, etc.)
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*', 'fs', 'path', 'crypto', 'os', 'child_process', 'stream'],
              message: 'Node.js modules are banned in apps/mobile per CS-5.',
            },
            {
              group: ['apps/api/**', '**/apps/api/**'],
              message: 'apps/mobile may not import from apps/api per CS-5.',
            },
            {
              group: ['@prisma/client', 'ioredis', 'bullmq', 'argon2', 'jose'],
              message: 'Server packages are banned in apps/mobile per CS-5.',
            },
          ],
        },
      ],
    },
  },
);
