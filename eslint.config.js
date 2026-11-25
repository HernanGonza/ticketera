import js from '@eslint/js';
import hooks from 'eslint-plugin-react-hooks';
import ts from 'typescript-eslint';

export default ts.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '.data*/**', 'graft/**', '.claude/**', 'docs/**', 'playwright-report/**', 'test-results/**'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly', setInterval: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', URL: 'readonly', fetch: 'readonly', Buffer: 'readonly' } },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': hooks },
    rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'warn' },
  },
  { rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }] } },
);
