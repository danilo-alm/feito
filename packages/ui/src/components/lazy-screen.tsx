"use client";

import { Component, Suspense, lazy, useState, type ComponentType, type ReactNode } from "react";
import { useT } from "./language";
import { Spinner } from "./ui";

class ScreenBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Adia apenas a tela, mantendo navegação, diálogos e rascunhos fora da suspensão. */
export function lazyScreen<Props extends object>(load: () => Promise<{ default: ComponentType<Props> }>) {
  const InitialScreen = lazy(load);

  return function DeferredScreen(props: Props) {
    const t = useT();
    const [{ Screen, attempt }, setScreen] = useState(() => ({ Screen: InitialScreen, attempt: 0 }));
    return (
      <ScreenBoundary key={attempt} fallback={<div className="empty">
        <strong role="alert">{t("Não foi possível carregar o Feito.")}</strong>
        <button type="button" className="btn" onClick={() => setScreen(({ attempt }) => ({ Screen: lazy(load), attempt: attempt + 1 }))}>
          {t("Tentar de novo")}
        </button>
      </div>}>
        <Suspense fallback={<Spinner />}>
          <Screen {...props} />
        </Suspense>
      </ScreenBoundary>
    );
  };
}
