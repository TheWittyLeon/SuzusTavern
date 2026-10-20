// A jsdom jest environment that also exposes Node's Fetch API classes (jsdom ships none).
// For tests that render components AND run code built on Request/Response, e.g. src/proxy.ts's
// NextRequest. Use via the docblock: `@jest-environment <rootDir>/src/test-utils/jsdom-with-fetch-env.js`.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS file: jest loads an environment with require()
const JsdomEnvironment = require('jest-environment-jsdom').default;

class JsdomWithFetchEnvironment extends JsdomEnvironment {
  constructor(...args) {
    super(...args);
    for (const name of ['Request', 'Response', 'Headers', 'fetch', 'FormData', 'ReadableStream', 'TextEncoder', 'TextDecoder']) {
      if (typeof this.global[name] === 'undefined' && typeof globalThis[name] !== 'undefined') {
        this.global[name] = globalThis[name];
      }
    }
  }
}

module.exports = JsdomWithFetchEnvironment;
