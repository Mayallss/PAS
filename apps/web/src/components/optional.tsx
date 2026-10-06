'use client';

import { Component, type ReactNode } from 'react';

/**
 * Wraps a non-essential widget (notification bell, integration status, side cards). If it throws while rendering,
 * only that widget is replaced by `fallback` (nothing by default) — the page and the app shell keep working.
 */
export class Optional extends Component<{ children: ReactNode; fallback?: ReactNode; name?: string }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn(`[optional] ${this.props.name ?? 'widget'} hidden after an error`, error);
  }

  render() {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children;
  }
}
