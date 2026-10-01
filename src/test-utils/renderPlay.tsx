/**
 * renderPlay — `render()` for suites that mount `/play` (A9c C6, build brief 5.4).
 *
 * The real app always has a <ThemeProvider> above /play (app/layout.tsx), and
 * /play reads it: the layout preference (`usePlayLayout`), the fold preference
 * (the shell) and the TweaksPanel. A suite that mounts the page with no
 * provider tests a tree that cannot exist, and used to need a no-provider
 * fallback in production code (`useThemeOptional`, retired with this file).
 *
 * `wrapper` is applied by RTL to `rerender` as well, so a re-render keeps the
 * provider. Outside `__tests__/` on purpose: jest would run it as a suite.
 */
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { ThemeProvider } from '@/lib/theme/ThemeProvider';

export function renderPlay(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>): RenderResult {
  return render(ui, { wrapper: ThemeProvider, ...options });
}
