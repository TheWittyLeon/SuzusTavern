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

// jsdom does not implement Element.scrollIntoView. Several components call it
// (via rAF, e.g. the play page's check-invite focus-catch) — without a stub
// this throws an uncaught exception inside the animation-frame callback that
// jsdom reports against whichever test happens to be running when the frame
// fires, producing order-dependent flakes unrelated to the calling test.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = jest.fn();
}
