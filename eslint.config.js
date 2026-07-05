import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dist-server/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/src-tauri/**',
      '**/*.json',
      '**/*.yaml',
      '**/*.yml',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // ponytail: codebase uses `any` for dynamic AWS responses; stylistic rules → warn.
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-regex-spaces': 'warn',
      'no-empty': 'warn',
      'prefer-const': 'warn',
      '@typescript-eslint/no-non-null-asserted-optional-chain': 'warn',
      '@typescript-eslint/no-unused-expressions': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['packages/cli/src/**/*.ts', 'packages/cli/scripts/**/*.mjs', 'packages/sdk/src/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
)
