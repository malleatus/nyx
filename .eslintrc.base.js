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
    'plugin:@typescript-eslint/recommended',
    'plugin:node/recommended',
  ],
  env: {
    node: true,
  },
  rules: {
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        // default values
        vars: 'all',
        args: 'after-used',
        caughtErrors: 'none',

        // customizing to change ignoreRestSiblings to `true`
        ignoreRestSiblings: true,
      },
    ],
  },
  overrides: [
    {
      // typescript files
      files: ['**/*.ts'],
      settings: {
        node: {
          tryExtensions: ['.js', '.json', '.d.ts', '.ts'],
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
      rules: {
        'node/no-unpublished-import': 'off',
      },
    },
  ],
};
