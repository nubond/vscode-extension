const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const { defineConfig, globalIgnores } = require('eslint/config');

module.exports = defineConfig([
    globalIgnores(['dist/**', 'coverage/**', 'node_modules/**']),
    {
        files: ['**/*.ts'],
        extends: [js.configs.recommended, tseslint.configs.recommended],
        languageOptions: {
            ecmaVersion: 2020,
            sourceType: 'module',
        },
        rules: {
            // Underscore-prefixed parameters are deliberate: provider callbacks
            // must match the vscode API signature even where they ignore an
            // argument (`_token`, `_context`), and the same holds for the TS
            // server plugin's `init(_modules)`.
            '@typescript-eslint/no-unused-vars': ['error', {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_',
                caughtErrorsIgnorePattern: '^_',
            }],
            // A few seams genuinely need `any` to reach internal TypeScript
            // server and vscode API shapes. Keep them visible as warnings
            // rather than either failing the build or hiding them.
            '@typescript-eslint/no-explicit-any': 'warn',
        },
    },
]);
