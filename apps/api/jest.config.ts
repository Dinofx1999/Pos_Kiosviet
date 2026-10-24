import type { Config } from 'jest';

const base: Partial<Config> = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json', isolatedModules: true }] },
  moduleNameMapper: {
    '^@erp/shared$': '<rootDir>/../../packages/shared/src/index.ts',
    '^src/(.*)$': '<rootDir>/src/$1',
  },
  testEnvironment: 'node',
};

const config: Config = {
  testTimeout: 60000,
  projects: [
    { ...base, displayName: 'unit', testMatch: ['<rootDir>/src/**/*.spec.ts'] } as Config,
    {
      ...base,
      displayName: 'integration',
      testMatch: ['<rootDir>/test/**/*.e2e-spec.ts'],
      globalSetup: '<rootDir>/test/global-setup.ts',
      setupFilesAfterEnv: ['<rootDir>/test/jest-setup.ts'],
    } as Config,
  ],
};
export default config;
