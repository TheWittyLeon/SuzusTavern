import { render, screen, act } from '@testing-library/react';
import ErrorBoundary from '@/components/ErrorBoundary';

// Suppress the React error console noise produced by error boundary tests.
//
// IMPORTANT: We use jest.spyOn per-describe (not beforeAll/afterAll) to avoid
// a React 18 + jsdom worker-process teardown issue. When console.error is
// replaced via direct assignment in beforeAll, React's concurrent scheduler
// retains a reference across async boundaries in the Jest worker, preventing
// clean exit and causing an intermittent SIGSEGV / "worker has failed to exit
// gracefully" warning. jest.spyOn is reference-safe and mockRestore() in
// afterEach is deterministic.
//
// The filter passes through unexpected errors so real test failures still surface.
function suppressErrorBoundaryNoise() {
  return jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    const msg = String(args[0] ?? '');
    if (
      msg.includes('The above error occurred') ||
      msg.includes('Error: Uncaught') ||
      msg.includes('Consider adding an error boundary') ||
      // React 18 passes the raw Error object as args[0]; suppress those too.
      (args[0] instanceof Error)
    ) {
      return;
    }
    // Let anything else through so real problems aren't silenced.
    console.warn('[ErrorBoundary test suppressed unexpected console.error]', ...args);
  });
}

// A component that throws on demand
function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('Kaboom');
  return <div data-testid="child">safe</div>;
}

describe('ErrorBoundary', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = suppressErrorBoundaryNoise();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('renders children when no error occurs', () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('catches a throwing child and shows the default fallback with role="alert"', () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow />
      </ErrorBoundary>,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveAttribute('data-component', 'ErrorBoundary');
  });

  it('shows "Try again" button in the default fallback', () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow />
      </ErrorBoundary>,
    );
    expect(
      screen.getByRole('button', { name: /try again/i }),
    ).toBeInTheDocument();
  });

  it('reset() clears error state so a non-throwing child renders', () => {
    let throwFlag = true;

    function Child() {
      if (throwFlag) throw new Error('fail');
      return <div data-testid="recovered">ok</div>;
    }

    const { rerender } = render(
      <ErrorBoundary>
        <Child />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();

    // Flip the throw flag, then trigger reset via the button
    throwFlag = false;
    act(() => {
      screen.getByRole('button', { name: /try again/i }).click();
    });

    // Re-render to pick up the now-non-throwing child
    rerender(
      <ErrorBoundary>
        <Child />
      </ErrorBoundary>,
    );

    expect(screen.getByTestId('recovered')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('accepts a custom ReactNode fallback', () => {
    render(
      <ErrorBoundary fallback={<p data-testid="custom">Custom error</p>}>
        <Bomb shouldThrow />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('custom')).toBeInTheDocument();
  });

  it('accepts a custom render-function fallback and passes error + reset', () => {
    let capturedError: Error | null = null;

    render(
      <ErrorBoundary
        fallback={(err, reset) => {
          capturedError = err;
          return (
            <button data-testid="fn-reset" onClick={reset}>
              fn-reset
            </button>
          );
        }}
      >
        <Bomb shouldThrow />
      </ErrorBoundary>,
    );

    expect(screen.getByTestId('fn-reset')).toBeInTheDocument();
    expect(capturedError).not.toBeNull();
    expect((capturedError as unknown as Error).message).toBe('Kaboom');
  });

  it('render-function reset clears error state', () => {
    let throwFlag = true;

    function Child() {
      if (throwFlag) throw new Error('fail');
      return <div data-testid="ok">ok</div>;
    }

    const { rerender } = render(
      <ErrorBoundary
        fallback={(_err, reset) => (
          <button data-testid="fn-reset" onClick={reset}>
            reset
          </button>
        )}
      >
        <Child />
      </ErrorBoundary>,
    );

    throwFlag = false;
    act(() => {
      screen.getByTestId('fn-reset').click();
    });

    rerender(
      <ErrorBoundary
        fallback={(_err, reset) => (
          <button data-testid="fn-reset" onClick={reset}>
            reset
          </button>
        )}
      >
        <Child />
      </ErrorBoundary>,
    );

    expect(screen.getByTestId('ok')).toBeInTheDocument();
  });

  it('calls onError with the error and error info when a child throws', () => {
    const onError = jest.fn();

    render(
      <ErrorBoundary onError={onError}>
        <Bomb shouldThrow />
      </ErrorBoundary>,
    );

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(onError.mock.calls[0][0].message).toBe('Kaboom');
    expect(onError.mock.calls[0][1]).toHaveProperty('componentStack');
  });

  it('shows the error message in dev (NODE_ENV=test ≠ production)', () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Kaboom')).toBeInTheDocument();
  });
});
