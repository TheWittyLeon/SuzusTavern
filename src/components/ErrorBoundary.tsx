'use client';

import { Component, type ReactNode, type ErrorInfo } from 'react';
import Button from '@/components/Button';
import styles from '@/components/ErrorBoundary.module.css';

// ---- Prop types ----

type FallbackRender = (error: Error, reset: () => void) => ReactNode;

export interface ErrorBoundaryProps {
  /** Custom fallback. Can be a ReactNode or a render function receiving (error, reset). */
  fallback?: ReactNode | FallbackRender;
  /** Called after an error is caught — useful for error-reporting pipelines. */
  onError?: (error: Error, info: ErrorInfo) => void;
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * React class error boundary.
 *
 * Catches render/lifecycle errors in the subtree and shows a fallback UI.
 * The default fallback is a `.glass` Card-style panel with a heading, an
 * optional error message (dev only — gated on NODE_ENV), and a "Try again"
 * Button that clears the error state.
 *
 * Usage:
 *   <ErrorBoundary>
 *     <SomeComponent />
 *   </ErrorBoundary>
 *
 *   // Custom render-fn fallback:
 *   <ErrorBoundary fallback={(err, reset) => <button onClick={reset}>retry</button>}>
 *     ...
 *   </ErrorBoundary>
 */
export default class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
    this.reset = this.reset.bind(this);
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  reset(): void {
    this.setState({ error: null });
  }

  render(): ReactNode {
    const { error } = this.state;
    const { fallback, children } = this.props;

    if (error !== null) {
      // Render-function fallback
      if (typeof fallback === 'function') {
        return (fallback as FallbackRender)(error, this.reset);
      }

      // Node fallback
      if (fallback !== undefined) {
        return fallback;
      }

      // Default fallback
      const isDev = process.env.NODE_ENV !== 'production';

      return (
        <div
          role="alert"
          data-component="ErrorBoundary"
          className={`glass ${styles.panel}`}
        >
          <h3 className={styles.heading}>Something went wrong</h3>
          {isDev && error.message && (
            <p className={styles.message}>{error.message}</p>
          )}
          <Button onClick={this.reset} variant="ghost" className={styles.action}>
            Try again
          </Button>
        </div>
      );
    }

    return children;
  }
}
