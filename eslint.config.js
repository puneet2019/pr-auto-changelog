// ESLint v9 flat config
import js from '@eslint/js';
import globals from 'globals';

export default [
  // Ignore build outputs and the config file itself
  { ignores: ['dist/**', 'eslint.config.js'] },

  // Base recommended rules for JS
  js.configs.recommended,

  // Node/CommonJS project settings
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
    rules: {
      // Keep minimal rules to avoid introducing new failures during the bump
    },
  },

  // Jest test files
  {
    files: ['**/*.test.js'],
    languageOptions: {
      globals: {
        ...globals.jest,
        ...globals.node,
      },
    },
  },
];
