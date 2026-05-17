/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/tests'],
    testMatch: ['**/*.spec.ts'],
    moduleNameMapper: {
        '^vscode$': '<rootDir>/tests/__mocks__/vscode.ts',
    },
    transform: {
        '^.+\\.tsx?$': ['ts-jest', {
            tsconfig: {
                target: 'ES2020',
                module: 'commonjs',
                lib: ['ES2020'],
                strict: true,
                esModuleInterop: true,
                skipLibCheck: true,
                resolveJsonModule: true,
                experimentalDecorators: true,
                types: ['jest', 'node'],
            },
        }],
    },
};
