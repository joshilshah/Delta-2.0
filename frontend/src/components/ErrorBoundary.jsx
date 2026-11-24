import { Component } from 'react';

/** Last line of defence: a rendering error shows a recoverable message instead of a blank page. */
export default class ErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch(error, info) {
    console.error('UI error:', error, info?.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="grid min-h-screen place-items-center px-4">
        <div className="max-w-sm space-y-4 text-center">
          <h1 className="text-3xl font-bold">Something went wrong</h1>
          <p className="text-sm text-muted">The page hit an unexpected error. Your account and any active ride are safe.</p>
          <div className="flex justify-center gap-3">
            <button className="btn-primary" onClick={() => window.location.reload()}>Reload</button>
            <button className="btn-outline" onClick={() => { window.location.href = '/'; }}>Go home</button>
          </div>
        </div>
      </div>
    );
  }
}
