import '@testing-library/jest-dom';

// jsdom does not implement window.matchMedia. Provide a minimal stub so any
// component using useReducedMotion (or other media-query hooks) can mount.
// The guard ensures this does not throw in Node-environment test suites
// (api/lib tests that don't use jsdom).
// Individual tests that need to control the returned value should override
// window.matchMedia with jest.fn() before rendering.
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  });
}
