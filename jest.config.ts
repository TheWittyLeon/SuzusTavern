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
  // Kage-CR I7 (2026-09-21 review): a pre-existing CPU-contention flake
  // cluster, reproduced on unmodified main (3383 pass, then 6 fail, then 25
  // fail across three back-to-back full-suite runs; none in /play, all
  // slow/timer-heavy suites, no assertion failures — timeouts under worker
  // contention) and independently observed twice this session (a
  // waitFor()-based focus assertion once, a SIGSEGV worker crash once,
  // neither reproducing on immediate re-run). Jest's default spawns one
  // worker per logical core, which oversubscribes the CPU on this machine
  // when other work is also running (the exact condition every one of
  // these observations occurred under). Capping to half the machine's
  // cores leaves headroom instead of every worker fighting for the same
  // cycles — this is a resource-contention mitigation, not a fix for any
  // individual test; a run this settles is evidence FOR the flake theory,
  // not proof no test still races.
  maxWorkers: '50%',
}

export default createJestConfig(config)
