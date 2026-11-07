// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_TOOLBAR_TOOLS,
  DetachedPreviewTitlebar,
  HomePromoCard,
  LIVE_UPDATE_FEATURES,
  LiveUpdateFeatureList,
  NewProjectTip,
  PerformanceNotice,
  QuickToolsBar,
  RenderSuccessCard,
  SplitScreenTemplates,
  SPLIT_SCREEN_TEMPLATES,
  ToolSelectorMenu,
  ToolbarCustomizerDialog,
  readToolbarTools,
} from './FilmoraStates';

const TOOLBAR_KEY = 'editor-ia.toolbar-tools.v2';

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  window.localStorage.clear();
});

describe('FilmoraStates · inicio (93)', () => {
  it('la tarjeta promocional navega al Director de IA real', () => {
    const onOpen = vi.fn();
    render(<HomePromoCard onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: /Abrir agente/i }));
    expect(onOpen).toHaveBeenCalledWith('director');
  });

  it('el globo del primer proyecto se puede cerrar', () => {
    const onDismiss = vi.fn();
    render(<NewProjectTip onDismiss={onDismiss} />);
    expect(screen.getByText(/Haz clic aquí para comenzar/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Cerrar guía/i }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});

describe('FilmoraStates · aviso de rendimiento (95)', () => {
  it('«Más información» despliega detalles reales y «Entendido» cierra', () => {
    const onDismiss = vi.fn();
    const { container } = render(<PerformanceNotice onDismiss={onDismiss} />);
    expect(container.querySelector('.fm-performance-notice-details')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Más información/i }));
    expect(container.querySelectorAll('.fm-performance-notice-details li').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /Entendido/i }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('no usa un rol alert que compita con los errores del store', () => {
    render(<PerformanceNotice onDismiss={() => {}} />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('group', { name: /Advertencia de rendimiento/i })).toBeTruthy();
  });
});

describe('FilmoraStates · exportación completada (97)', () => {
  it('abre la carpeta con el comando real y marca «Compartir» como pendiente', () => {
    const onOpenFolder = vi.fn();
    render(<RenderSuccessCard name="video.mp4" onOpenFolder={onOpenFolder} />);
    expect(screen.getByText(/Convertido con éxito/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Renderizar/i }));
    fireEvent.click(screen.getByRole('button', { name: /Resultado automático/i }));
    expect(onOpenFolder).toHaveBeenCalledTimes(2);
    const share = screen.getByRole('button', { name: /Compartir en redes/i }) as HTMLButtonElement;
    expect(share.disabled).toBe(true);
    expect(share.title).toMatch(/pendiente/i);
  });

  it('usa una composición SVG real en vez de un icono genérico', () => {
    const { container } = render(<RenderSuccessCard name="video.mp4" onOpenFolder={() => {}} />);
    const art = container.querySelector('.fm-render-art');
    expect(art?.tagName.toLowerCase()).toBe('svg');
    expect(art?.querySelectorAll('path, rect, circle').length).toBeGreaterThan(4);
    expect(container.querySelector('.fm-render-success-preview .ui-icon')).toBeNull();
  });
});

describe('FilmoraStates · vista previa desacoplada (109)', () => {
  it('los tres controles de la barra de título vuelven a acoplar', () => {
    const onDock = vi.fn();
    render(<DetachedPreviewTitlebar onDock={onDock}>Monitor</DetachedPreviewTitlebar>);
    for (const label of ['Minimizar vista previa', 'Acoplar vista previa', 'Cerrar ventana de vista previa']) {
      fireEvent.click(screen.getByRole('button', { name: label }));
    }
    expect(onDock).toHaveBeenCalledTimes(3);
  });
});

describe('FilmoraStates · plantillas Split Screen (114–117)', () => {
  it('selecciona una plantilla y declara pendiente la composición', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <SplitScreenTemplates selectedId={null} onSelect={onSelect} />,
    );
    const cards = container.querySelectorAll('.fm-split-templates-grid button');
    expect(cards.length).toBe(SPLIT_SCREEN_TEMPLATES.length);
    fireEvent.click(cards[0]!);
    expect(onSelect).toHaveBeenCalledWith(SPLIT_SCREEN_TEMPLATES[0]);
    expect(container.querySelector('.fm-split-templates-note')?.textContent).toMatch(/pendiente/i);
  });
});

describe('FilmoraStates · barra personalizable (126/128)', () => {
  it('lee el catálogo por defecto cuando no hay preferencia guardada', () => {
    expect(readToolbarTools()).toEqual([...DEFAULT_TOOLBAR_TOOLS]);
  });

  it('guarda la personalización en localStorage y notifica al timeline', () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(
      <ToolbarCustomizerDialog open onClose={onClose} onSaved={onSaved} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Detección de ritmo/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Guardar$/i }));
    expect(onSaved).toHaveBeenCalledOnce();
    expect(onSaved.mock.calls[0]![0]).toContain('rhythm');
    expect(JSON.parse(window.localStorage.getItem(TOOLBAR_KEY) ?? '[]')).toContain('rhythm');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('cada herramienta rápida con acción dispara el botón REAL y las pendientes quedan disabled', () => {
    const spy = vi.fn();
    const { container } = render(
      <>
        <div className="timeline-toolbar">
          <button type="button" aria-label="Borrar clip" onClick={spy} />
        </div>
        <QuickToolsBar tools={['delete', 'quick-text']} />
      </>,
    );
    const buttons = container.querySelectorAll<HTMLButtonElement>('.fm-quick-tool');
    expect(buttons).toHaveLength(2);
    expect(buttons[1]!.disabled).toBe(true);
    expect(buttons[1]!.title).toMatch(/pendiente/i);
    fireEvent.click(buttons[0]!);
    expect(spy).toHaveBeenCalledOnce();
  });
});

describe('FilmoraStates · selector de herramienta (127)', () => {
  it('abre el menú y entrega el modo elegido', () => {
    const onChange = vi.fn();
    render(<ToolSelectorMenu value="select" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Seleccionar herramienta/i }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Modo de división ágil/i }));
    expect(onChange).toHaveBeenCalledWith('agile-split');
  });
});

describe('FilmoraStates · novedades (98/99)', () => {
  it('la lista índice todas las funciones y selecciona por índice', () => {
    const onSelect = vi.fn();
    render(<LiveUpdateFeatureList activeIndex={0} onSelect={onSelect} />);
    const items = screen.getAllByRole('button');
    expect(items.length).toBe(LIVE_UPDATE_FEATURES.length);
    fireEvent.click(items[3]!);
    expect(onSelect).toHaveBeenCalledWith(3);
  });
});
