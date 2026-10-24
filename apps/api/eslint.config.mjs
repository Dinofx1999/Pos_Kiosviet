import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  {
    files: ['**/*.ts'],
    languageOptions: { parser: tsParser, parserOptions: { project: false, sourceType: 'module' } },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
];
