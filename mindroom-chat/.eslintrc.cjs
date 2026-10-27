const sharedSurfaceImportMessage =
  'Import surfaces from src/app/components/glass/GlassPrimitives; import other primitives from folds.';

module.exports = {
  env: {
    browser: true,
    es2021: true,
  },
  ignorePatterns: ['dist', 'node_modules', '**/*.css'],
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
    'plugin:@typescript-eslint/eslint-recommended',
    'plugin:@typescript-eslint/recommended',
    'airbnb',
    'prettier',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaFeatures: {
      jsx: true,
    },
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  globals: {
    JSX: 'readonly',
  },
  plugins: ['react', '@typescript-eslint'],
  rules: {
    'linebreak-style': 0,
    'no-underscore-dangle': 0,
    'no-shadow': 'off',
    'no-undef': 'off',
    'no-unused-vars': 'off',
    'no-use-before-define': 'off',
    'no-continue': 'off',
    'no-restricted-syntax': 'off',
    'no-param-reassign': 'off',
    'no-await-in-loop': 'off',
    'no-nested-ternary': 'off',
    'no-bitwise': 'off',
    'no-void': 'off',
    'no-plusplus': 'off',
    'no-loop-func': 'off',
    'no-empty': 'off',
    'no-empty-function': 'off',
    'no-useless-constructor': 'off',
    'no-useless-return': 'off',
    'no-lonely-if': 'off',
    'default-param-last': 'off',
    'consistent-return': 'off',
    'prefer-destructuring': 'off',
    'prefer-template': 'off',
    'operator-assignment': 'off',
    'max-classes-per-file': 'off',
    'class-methods-use-this': 'off',
    'arrow-body-style': 'off',
    'no-console': 'warn',
    'prefer-const': 'warn',

    'import/prefer-default-export': 'off',
    'import/extensions': 'off',
    'import/no-unresolved': 'off',
    'import/no-duplicates': 'off',
    'import/first': 'off',
    'import/no-extraneous-dependencies': [
      'error',
      {
        devDependencies: true,
      },
    ],

    'react/button-has-type': 'off',
    'react/function-component-definition': 'off',
    'react/no-unused-prop-types': 'off',
    'react/jsx-no-useless-fragment': 'off',
    'react/no-unstable-nested-components': ['error', { allowAsProps: true }],
    'react/jsx-filename-extension': [
      'error',
      {
        extensions: ['.tsx', '.jsx'],
      },
    ],

    'react/require-default-props': 'off',
    'react/jsx-props-no-spreading': 'off',
    'jsx-a11y/role-supports-aria-props': 'off',
    'jsx-a11y/no-static-element-interactions': 'off',
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',

    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-shadow': 'off',
    '@typescript-eslint/no-unused-vars': [
      'warn',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        ignoreRestSiblings: true,
      },
    ],
  },
  overrides: [
    {
      files: ['*.ts'],
      rules: {
        'no-undef': 'off',
      },
    },
    {
      files: ['src/**/*.{js,jsx,ts,tsx}'],
      excludedFiles: ['src/app/components/glass/GlassPrimitives.tsx'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: [
              {
                name: 'folds',
                importNames: ['Menu', 'MenuItem', 'Modal', 'Dialog', 'Header', 'default'],
                message: sharedSurfaceImportMessage,
              },
              // The pattern must allow this directory to allow its stylesheet.
              // Block the directory entry itself so it cannot expose index.js.
              { name: 'folds/dist', message: sharedSurfaceImportMessage },
              { name: 'folds/dist/', message: sharedSurfaceImportMessage },
            ],
            patterns: [
              {
                group: ['folds/**', '!folds/dist', '!folds/dist/style.css'],
                message: sharedSurfaceImportMessage,
              },
            ],
          },
        ],
      },
    },
  ],
};
