import type { Config } from 'jest'
import nextJest from 'next/jest.js'

const createJestConfig = nextJest({
  dir: './',
})

const config: Config = {
  coverageProvider: 'v8',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  // Give workers more time to exit gracefully after tests complete.
  // The default 500ms is too short for jsdom + React 18 concurrent scheduler
  // cleanup when workers switch between @jest-environment node and jsdom suites
  // in parallel runs. 2000ms gives React's MessageChannel/scheduler enough time
  // to drain async work before the worker is force-killed.
  workerGracefulExitTimeout: 2000,
}

export default createJestConfig(config)
