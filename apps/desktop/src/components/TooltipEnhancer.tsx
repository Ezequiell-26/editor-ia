import { useEffect } from 'react';

/**
 * Mejora global de tooltips — paridad de `dicas.js` de AlaukCut
 * (globo posicionado, delay, flip, foco).
 *
 * 1) Puente `title` → `data-tooltip`: los ~380 `title=` nativos del árbol
 *    heredan el globo estilado sin tocar cada componente. El `title` se
 *    retira mientras el elemento está bajo el cursor/foco (suprime el
 *    tooltip nativo del navegador) y se restaura al salir.
 * 2) Flip: si el elemento está a menos de 48 px del borde inferior del
 *    viewport, se agrega `.tooltip-flip` para que el globo salga hacia
 *    arriba (CSS en chrome.css). Se reevalúa en scroll/resize.
 *
 * El delay de 340 ms vive en el CSS (`transition-delay` sólo en el estado
 * `:hover`/`:focus-visible`: aparece tarde, desaparece sin delay).
 */

const FLIP_MARGIN = 48;

export function TooltipEnhancer() {
  useEffect(() => {
    let swapped: { el: Element; title: string; addedTip: boolean } | null = null;
    let hovered: Element | null = null;

    const applyFlip = (el: Element | null) => {
      document
        .querySelectorAll('.tooltip-flip')
        .forEach((node) => node.classList.remove('tooltip-flip'));
      if (!el || el.closest('.sidebar') || el.classList.contains('tooltip')) return;
      const rect = el.getBoundingClientRect();
      if (
        rect.bottom + FLIP_MARGIN > window.innerHeight &&
        rect.top > FLIP_MARGIN
      ) {
        el.classList.add('tooltip-flip');
      }
    };

    const restore = () => {
      if (!swapped) return;
      swapped.el.setAttribute('title', swapped.title);
      if (swapped.addedTip) swapped.el.removeAttribute('data-tooltip');
      swapped = null;
    };

    const enter = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return;
      const el = target.closest('[title],[data-tooltip]');
      if (!el) {
        hovered = null;
        applyFlip(null);
        return;
      }
      hovered = el;
      if (swapped?.el !== el) restore();
      const title = el.getAttribute('title');
      if (title) {
        const addedTip = !el.hasAttribute('data-tooltip');
        if (addedTip) el.setAttribute('data-tooltip', title);
        el.removeAttribute('title');
        swapped = { el, title, addedTip };
      }
      applyFlip(el);
    };

    const onEnter = (event: Event) => enter(event.target);
    const onOut = (event: Event) => {
      const mouse = event as MouseEvent;
      if (
        swapped &&
        mouse.relatedTarget instanceof Node &&
        swapped.el.contains(mouse.relatedTarget)
      ) {
        return;
      }
      restore();
      hovered = null;
      applyFlip(null);
    };

    const onScroll = () => applyFlip(hovered);

    document.addEventListener('mouseover', onEnter);
    document.addEventListener('focusin', onEnter);
    document.addEventListener('mouseout', onOut);
    document.addEventListener('focusout', onOut);
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mouseover', onEnter);
      document.removeEventListener('focusin', onEnter);
      document.removeEventListener('mouseout', onOut);
      document.removeEventListener('focusout', onOut);
      window.removeEventListener('scroll', onScroll, { capture: true });
      window.removeEventListener('resize', onScroll);
      restore();
      applyFlip(null);
    };
  }, []);
  return null;
}
