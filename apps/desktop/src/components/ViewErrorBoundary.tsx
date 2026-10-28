import { Component, type ReactNode } from 'react';

interface ViewErrorBoundaryProps {
  readonly children: ReactNode;
  /** Cambiar de vista reinicia el límite sin remontar el shell. */
  readonly resetKey: string;
  readonly onHome?: () => void;
  readonly onSettings?: () => void;
}

interface ViewErrorBoundaryState {
  readonly error: Error | null;
}

/**
 * Aísla el fallo de una herramienta. Sin este límite, un error de render en
 * cualquier vista desmonta React y deja la ventana en blanco; acá el resto del
 * shell sigue vivo y la persona puede reintentar o volver a Inicio.
 */
export class ViewErrorBoundary extends Component<
  ViewErrorBoundaryProps,
  ViewErrorBoundaryState
> {
  override state: ViewErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ViewErrorBoundaryState {
    return {
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }

  override componentDidUpdate(previous: ViewErrorBoundaryProps): void {
    if (previous.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <section className="view view-error" role="alert">
        <p className="eyebrow">Recuperación</p>
        <h2>La herramienta se detuvo</h2>
        <p>
          El resto de Olyvia sigue funcionando. Reintentá la herramienta o volvé a Inicio para
          seguir trabajando sin cerrar la app.
        </p>
        <pre>{error.message}</pre>
        <div className="actions">
          <button type="button" className="primary" onClick={() => this.setState({ error: null })}>
            Reintentar
          </button>
          {this.props.onHome ? (
            <button type="button" className="ghost" onClick={this.props.onHome}>
              Ir a Inicio
            </button>
          ) : null}
          {this.props.onSettings ? (
            <button type="button" className="ghost" onClick={this.props.onSettings}>
              Abrir Ajustes
            </button>
          ) : null}
        </div>
      </section>
    );
  }
}
