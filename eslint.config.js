import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'uploads/'] },
  js.configs.recommended,
  {
    // 앱, 스크립트, 테스트: ESM
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: globals.node },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  {
    // sequelize-cli 설정과 마이그레이션: CommonJS
    files: ['**/*.cjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'commonjs', globals: globals.node },
  },
];
