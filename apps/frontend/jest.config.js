/**
 * Jest para lógica pura do frontend (sem React/DOM).
 * Roda só arquivos *.logic.spec.ts / *Logic.spec.ts dentro de src/.
 */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { module: 'commonjs', moduleResolution: 'node', jsx: 'react-jsx', esModuleInterop: true, isolatedModules: true } }],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};
