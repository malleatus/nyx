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
    '@typescript-eslint/ban-ts-ignore': 'off',
    '@typescript-eslint/camelcase': 'off',
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
    'prefer-const': 'off',
  },
  overrides: [
    {
      // typescript files
      files: ['**/*.ts'],
      settings: {
        node: {
          tryExtensions: ['.js', '.json', '.d.ts', '.ts'],

          convertPath: [
            {
              include: ['src/**/*.ts'],
              replace: ['^src/(.+)\\.ts$', 'dist/$1.js'],
            },
          ],
        },
      },
      rules: {
        'node/no-unsupported-features/es-syntax': ['error', { ignores: ['modules'] }],
      },
    },
    {
      // local vendored types are not published
      files: ['types/**/*.d.ts'],
      rules: {
        'node/no-unpublished-import': 'off',
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
        '@typescript-eslint/explicit-function-return-type': 'off',
      },
    },
  ],
};
