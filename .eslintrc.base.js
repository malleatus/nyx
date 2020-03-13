module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2017,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', 'node'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/eslint-recommended',
    'plugin:node/recommended',
  ],
  env: {
    node: true,
  },
  rules: {},
  overrides: [
    {
      // typescript files
      files: ['**/*.ts'],
      settings: {
        node: {
          tryExtensions: ['.js', '.json', '.ts'],
        },
      },
      rules: {
        'node/no-unsupported-features/es-syntax': ['error', { ignores: ['modules'] }],
      },
    },
    {
      // test files
      files: ['__tests__/**/*.[jt]s', '**/*.test.[jt]s'],
      env: {
        jest: true,
      },
    },
    {
      files: ['src/index.ts'],
      rules: {
        'node/shebang': 0,
      },
    },
  ],
};
