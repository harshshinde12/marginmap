import { Component } from 'react';
import type { ReactNode } from 'react';

interface Props {
  tabName: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Catches render errors per tab so one crashing tab can't white-screen the whole cockpit. */
export class TabErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    // eslint-disable-next-line no-console
    console.error(`[MarginMap] ${this.props.tabName} tab crashed:`, error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-lg border border-red-300 bg-red-50 p-6 text-center dark:border-red-800 dark:bg-red-950">
          <div className="font-display text-lg font-bold text-red-800 dark:text-red-200">
            {this.props.tabName} couldn't render
          </div>
          <div className="mx-auto mt-1 max-w-xl font-mono text-xs text-red-700 dark:text-red-300">
            {this.state.error.message}
          </div>
          <button
            onClick={() => this.setState({ error: null })}
            className="mt-3 rounded bg-ink px-4 py-2 text-sm font-semibold text-white transition-all duration-175 hover:shadow dark:bg-neon"
          >
            Reload tab
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
