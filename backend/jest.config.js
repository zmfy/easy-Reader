/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts'],
  // 见 src/utils/import-esm.ts：jest 里改用不经改写的普通 JS，import() 才由当前测试文件的环境处理
  moduleNameMapper: { '^(.*)/utils/import-esm$': '<rootDir>/tests/helpers/import-esm.js' },
};
