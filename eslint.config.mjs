import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Codebase convention: an underscore-prefixed arg/var (e.g. `_args`)
      // signals "intentionally unused" (common in jest mock signatures that
      // must match a real function's arity). Recognize it instead of
      // forcing awkward disable comments at every call site.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated test coverage output (gitignored, non-deterministic presence).
    "coverage/**",
    // Static design-system reference assets served as-is by Next's public/
    // folder — never imported or compiled by app code, not real source.
    "public/**",
  ]),
]);

export default eslintConfig;
