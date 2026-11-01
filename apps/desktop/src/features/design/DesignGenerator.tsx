import { useEffect, useRef, useState } from 'react';
import type { Asset } from '@editor-ia/project-schema';
import type { ViewId } from '../../app/navigation';
import { Icon } from '../../components/Icon';
import type {
  DesignCritiqueReply,
  DesignDirection,
  DesignFormat,
  DesignReply,
} from '../../services/project-service';
import { addAsset, addClipFromAsset } from '../../state/project-actions';
import { useProjectStore } from '../../state/project-store';
import { writeClipboard } from './clipboard';
import { applyDesignSystem } from './design-selection';
import {
  loadCraftDoc,
  loadDesignSystemTokens,
  type CraftEntry,
  type DesignSystemEntry,
} from './open-design';
import { renderDeckToPdf, type DesignPdfResult } from './pdf';
import { renderDesignToPng, type DesignPngResult } from './rasterize';
import { renderDesignToVideo, type DesignVideoResult } from './video';

const FORMATS: readonly {
  readonly id: DesignFormat;
  readonly label: string;
  readonly hint: string;
}[] = [
  { id: 'page', label: 'Página', hint: 'Prototipo responsive' },
  { id: 'dashboard', label: 'Dashboard', hint: '1440×900 · datos' },
  { id: 'deck', label: 'Deck', hint: '1280×720 · slide' },
  { id: 'card', label: 'Tarjeta', hint: '1080×1080 · social' },
  { id: 'thumbnail', label: 'Miniatura', hint: '1280×720 · video' },
];

const BRIEF_LIMIT = 4_000;

export function DesignGenerator({
  system,
  craft,
  recipe = null,
  initialFormat = 'page',
  open,
  onClose,
  onNavigate,
}: {
  readonly system: DesignSystemEntry | null;
  readonly craft: readonly CraftEntry[];
  readonly recipe?: { readonly title: string; readonly text: string } | null;
  readonly initialFormat?: DesignFormat;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onNavigate?: (id: ViewId) => void;
}) {
  const store = useProjectStore();
  const [brief, setBrief] = useState('');
  const [format, setFormat] = useState<DesignFormat>(initialFormat);
  const [includeCraft, setIncludeCraft] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [result, setResult] = useState<DesignReply | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [png, setPng] = useState<DesignPngResult | null>(null);
  const [pngBusy, setPngBusy] = useState(false);
  const [pngError, setPngError] = useState<string | null>(null);
  const [pngSaved, setPngSaved] = useState<string | null>(null);
  const [video, setVideo] = useState<DesignVideoResult | null>(null);
  const [videoBusy, setVideoBusy] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [videoSaved, setVideoSaved] = useState<string | null>(null);
  const [videoSeconds, setVideoSeconds] = useState(3);
  const [videoFps, setVideoFps] = useState(15);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [mediaSent, setMediaSent] = useState<string | null>(null);
  const [mediaAsset, setMediaAsset] = useState<Asset | null>(null);
  const [pdf, setPdf] = useState<DesignPdfResult | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfSaved, setPdfSaved] = useState<string | null>(null);
  const [critique, setCritique] = useState<DesignCritiqueReply | null>(null);
  const [critiqueBusy, setCritiqueBusy] = useState(false);
  const [critiqueError, setCritiqueError] = useState<string | null>(null);
  const [directions, setDirections] = useState<readonly DesignDirection[]>([]);
  const [selectedDirection, setSelectedDirection] = useState<DesignDirection | null>(null);
  const [directionsBusy, setDirectionsBusy] = useState(false);
  const [directionsError, setDirectionsError] = useState<string | null>(null);
  const [patchInstruction, setPatchInstruction] = useState('');
  const [patchBusy, setPatchBusy] = useState(false);
  const [patchError, setPatchError] = useState<string | null>(null);
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const [discovery, setDiscovery] = useState({
    what: '',
    audience: '',
    goal: '',
    tone: '',
  });
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const titleId = 'design-generator-title';

  useEffect(() => {
    if (!open) return;
    setFormat(initialFormat);
    previousFocus.current = document.activeElement as HTMLElement | null;
    const timer = window.setTimeout(() => textareaRef.current?.focus(), 30);
    return () => {
      window.clearTimeout(timer);
      previousFocus.current?.focus?.();
    };
  }, [open, initialFormat]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = [
        ...dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), a[href]',
        ),
      ];
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, busy, onClose]);

  useEffect(() => {
    setResult(null);
    setSaved(null);
    setPng(null);
    setPngSaved(null);
    setPngError(null);
    setError(null);
    setWarning(null);
  }, [system?.id]);

  useEffect(
    () => () => {
      if (video) URL.revokeObjectURL?.(video.url);
    },
    [video],
  );

  if (!open || !system) return null;

  function applyDiscovery(): void {
    const what = discovery.what.trim();
    const audience = discovery.audience.trim();
    const goal = discovery.goal.trim();
    const tone = discovery.tone.trim();
    if (!what || !audience || !goal) return;
    const composed = [
      what.endsWith('.') ? what : `${what}.`,
      `Público: ${audience.endsWith('.') ? audience : `${audience}.`}`,
      `Objetivo: ${goal.endsWith('.') ? goal : `${goal}.`}`,
      tone ? `Tono y restricciones: ${tone.endsWith('.') ? tone : `${tone}.`}` : '',
    ]
      .filter(Boolean)
      .join(' ');
    setBrief(composed);
    setDiscoveryOpen(false);
    setDirectionsError(null);
    store.setNotice('Brief construido con las respuestas.');
  }

  function directionRecipe(direction: DesignDirection): string {
    return [
      `Dirección visual: ${direction.name}`,
      `Concepto: ${direction.concept}`,
      `Paleta: fondo ${direction.bg}, superficie ${direction.surface}, texto ${direction.fg}, acento ${direction.accent}, texto sobre acento ${direction.accentOn}.`,
      `Tipografías: display ${direction.displayFont}, body ${direction.bodyFont}.`,
      `Layout: ${direction.layout}`,
      `Por qué: ${direction.why}`,
    ].join(String.fromCharCode(10));
  }

  async function proposeDirections(): Promise<void> {
    if (brief.trim().length < 20) {
      setDirectionsError('Escribí un brief de al menos 20 caracteres.');
      return;
    }
    setDirectionsBusy(true);
    setDirectionsError(null);
    setDirections([]);
    setSelectedDirection(null);
    try {
      const reply = await store.service.generateDesignDirections({
        brief: brief.trim(),
        approvedCost: false,
      });
      setDirections(reply.directions);
      store.setNotice(`${reply.directions.length} direcciones propuestas.`);
    } catch (reason) {
      setDirectionsError(
        reason instanceof Error ? reason.message : 'No se pudieron proponer direcciones.',
      );
    } finally {
      setDirectionsBusy(false);
    }
  }

  function applyDirectionPalette(direction: DesignDirection): void {
    const selection = applyDesignSystem({
      id: `direction-${direction.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      name: direction.name,
      canvas: {
        accent: direction.accent,
        accentOn: direction.accentOn,
        bg: direction.bg,
        fg: direction.fg,
      },
    });
    if (!selection) {
      setDirectionsError('La dirección no tiene un acento utilizable.');
      return;
    }
    store.setNotice(`Paleta ${direction.name} aplicada a miniaturas y Motion.`);
  }

  async function loadGenerationContext(): Promise<{
    tokensCss: string;
    craftTexts: string[];
  }> {
    if (!system) return { tokensCss: '', craftTexts: [] };
    const tokensCss = await loadDesignSystemTokens(system);
    const craftTexts: string[] = [];
    let craftFailures = 0;
    if (includeCraft) {
      const selected = system.craft.suggested
        .map((id) => craft.find((entry) => entry.id === id))
        .filter((entry): entry is CraftEntry => Boolean(entry))
        .slice(0, 2);
      for (const entry of selected) {
        try {
          craftTexts.push(await loadCraftDoc(entry));
        } catch {
          craftFailures += 1;
        }
      }
      if (craftFailures > 0) {
        setWarning(
          `${craftFailures} regla(s) de craft no se pudieron leer; el diseño se generó con las disponibles.`,
        );
      }
    }
    return { tokensCss, craftTexts };
  }

  async function generate(): Promise<void> {
    if (!system) return;
    if (brief.trim().length < 20) {
      setError('Escribí un brief de al menos 20 caracteres: qué es, para quién y qué debe lograr.');
      return;
    }
    if (brief.length > BRIEF_LIMIT) {
      setError(`El brief supera los ${BRIEF_LIMIT.toLocaleString('es-AR')} caracteres.`);
      return;
    }
    setBusy(true);
    setError(null);
    setWarning(null);
    setSaved(null);
    setPng(null);
    setPngSaved(null);
    setPngError(null);
    setVideo(null);
    setVideoSaved(null);
    setVideoError(null);
    setPdf(null);
    setPdfSaved(null);
    setPdfError(null);
    try {
      const { tokensCss, craftTexts } = await loadGenerationContext();
      const reply = await store.service.generateDesign({
        brief: brief.trim(),
        format,
        systemName: system.name,
        tokensCss,
        craft: craftTexts,
        ...(selectedDirection
          ? { recipe: directionRecipe(selectedDirection) }
          : recipe
            ? { recipe: recipe.text }
            : {}),
        approvedCost: true,
      });
      setResult(reply);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo generar el diseño.');
    } finally {
      setBusy(false);
    }
  }

  async function save(): Promise<void> {
    if (!result) return;
    setError(null);
    try {
      const path = await store.service.saveDesignHtml(
        result.html,
        brief.trim().slice(0, 60) || `diseno-${system?.id ?? 'olyvia'}`,
      );
      if (path) {
        setSaved(path);
        store.setNotice('Diseño HTML guardado.');
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo guardar el HTML.');
    }
  }

  async function renderPng(): Promise<void> {
    if (!result) return;
    setPngBusy(true);
    setPngError(null);
    setPngSaved(null);
    try {
      const next = await renderDesignToPng(result.html, result.format);
      setPng(next);
      store.setNotice(`PNG ${next.width}×${next.height} listo para guardar.`);
    } catch (reason) {
      setPngError(reason instanceof Error ? reason.message : 'No se pudo rasterizar el diseño.');
    } finally {
      setPngBusy(false);
    }
  }

  async function exportPdf(): Promise<void> {
    if (!result) return;
    setPdfBusy(true);
    setPdfError(null);
    setPdfSaved(null);
    try {
      const next = await renderDeckToPdf(result.html, result.format);
      setPdf(next);
      store.setNotice(`PDF con ${next.pages} página(s) listo para guardar.`);
    } catch (reason) {
      setPdfError(reason instanceof Error ? reason.message : 'No se pudo crear el PDF.');
    } finally {
      setPdfBusy(false);
    }
  }

  async function savePdf(): Promise<void> {
    if (!pdf) return;
    setPdfError(null);
    try {
      const path = await store.service.saveDesignPdf(
        pdf.base64,
        brief.trim().slice(0, 60) || `deck-${system?.id ?? 'olyvia'}`,
      );
      if (path) {
        setPdfSaved(path);
        store.setNotice('PDF del deck guardado.');
      }
    } catch (reason) {
      setPdfError(reason instanceof Error ? reason.message : 'No se pudo guardar el PDF.');
    }
  }

  async function critiqueDesign(): Promise<void> {
    if (!result) return;
    setCritiqueBusy(true);
    setCritiqueError(null);
    setCritique(null);
    try {
      const next = await store.service.critiqueDesign({
        html: result.html,
        brief,
        approvedCost: false,
      });
      setCritique(next);
      store.setNotice('Revisión de diseño lista.');
    } catch (reason) {
      setCritiqueError(
        reason instanceof Error ? reason.message : 'No se pudo revisar el diseño.',
      );
    } finally {
      setCritiqueBusy(false);
    }
  }

  async function fixWithCritique(): Promise<void> {
    if (!result || !critique || !system) return;
    setBusy(true);
    setError(null);
    try {
      const { tokensCss, craftTexts } = await loadGenerationContext();
      const previous = result.html.length > 60_000
        ? result.html.slice(0, 60_000)
        : result.html;
      const reply = await store.service.generateDesign({
        brief: brief.trim(),
        format,
        systemName: system.name,
        tokensCss,
        craft: craftTexts,
        recipe: `Diseño anterior:
${previous}

Crítica a corregir:
${critique.critique}`,
        approvedCost: true,
      });
      setResult(reply);
      setCritique(null);
      store.setNotice('Diseño corregido con la crítica.');
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'No se pudo corregir el diseño con la crítica.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function copyHandoff(): Promise<void> {
    if (!result || !system) return;
    setError(null);
    try {
      const tokensCss = await loadDesignSystemTokens(system);
      const direction = selectedDirection
        ? [
            `Dirección elegida: ${selectedDirection.name}`,
            `Concepto: ${selectedDirection.concept}`,
            `Layout: ${selectedDirection.layout}`,
          ].join(String.fromCharCode(10))
        : 'Dirección: sistema activo.';
      const markdown = [
        `# Handoff — ${system.name}`,
        '',
        `Formato: ${format}`,
        `Brief: ${brief.trim()}`,
        direction,
        `Modelo: ${result.model}`,
        `HTML: ${result.html.length} caracteres autocontenidos, sin scripts ni recursos externos.`,
        '',
        '## Tokens CSS',
        '```css',
        tokensCss.trim(),
        '```',
        '',
        '## Tipografías',
        `Display: ${system.fonts.display ?? 'sin declarar'}`,
        `Body: ${system.fonts.body ?? 'sin declarar'}`,
        '',
        '## Paleta',
        Object.entries(system.canvas)
          .map(([key, value]) => `- ${key}: ${value ?? '—'}`)
          .join(String.fromCharCode(10)),
        '',
        '## Reglas de craft',
        system.craft.suggested.length > 0
          ? system.craft.suggested.map((rule) => `- ${rule}`).join(String.fromCharCode(10))
          : '- El sistema no declara reglas específicas.',
      ].join(String.fromCharCode(10));
      const copied = await writeClipboard(markdown);
      store.setNotice(copied ? 'Handoff copiado.' : 'No se pudo copiar el handoff.');
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'No se pudo preparar el handoff.',
      );
    }
  }

  async function applyPatch(): Promise<void> {
    if (!result || !system) return;
    const instruction = patchInstruction.trim();
    if (instruction.length < 3) {
      setPatchError('Escribí una instrucción de al menos 3 caracteres.');
      return;
    }
    setPatchBusy(true);
    setPatchError(null);
    try {
      const { tokensCss, craftTexts } = await loadGenerationContext();
      const previous = result.html.length > 60_000
        ? result.html.slice(0, 60_000)
        : result.html;
      const reply = await store.service.generateDesign({
        brief: brief.trim(),
        format,
        systemName: system.name,
        tokensCss,
        craft: craftTexts,
        recipe: `Diseño anterior:
${previous}

Instrucción de edición:
${instruction}`,
        approvedCost: true,
      });
      setResult(reply);
      setCritique(null);
      setPatchInstruction('');
      store.setNotice('Cambio aplicado al diseño.');
    } catch (reason) {
      setPatchError(
        reason instanceof Error ? reason.message : 'No se pudo aplicar el cambio.',
      );
    } finally {
      setPatchBusy(false);
    }
  }

  async function createVideo(): Promise<void> {
    if (!result) return;
    setVideoBusy(true);
    setVideoError(null);
    setVideoSaved(null);
    try {
      const next = await renderDesignToVideo(result.html, result.format, {
        durationSeconds: videoSeconds,
        fps: videoFps,
      });
      setVideo(next);
      store.setNotice(`Video ${next.width}×${next.height} · ${next.durationSeconds} s listo.`);
    } catch (reason) {
      setVideoError(reason instanceof Error ? reason.message : 'No se pudo crear el video.');
    } finally {
      setVideoBusy(false);
    }
  }

  async function sendToMedia(kind: 'png' | 'mp4'): Promise<void> {
    const asset = kind === 'png' ? png : video;
    if (!asset) return;
    const project = store.state.project;
    if (!project) {
      setMediaError('Abrí un proyecto para enviar el diseño a Medios.');
      return;
    }
    setMediaBusy(true);
    setMediaError(null);
    setMediaSent(null);
    try {
      const path = await store.service.stageDesignMedia(asset.base64, kind);
      const outcome = await store.service.importMediaPaths({
        paths: [path],
        fpsNum: project.video.frameRate.num,
        fpsDen: project.video.frameRate.den,
        confirmRights: true,
        provider: 'olyvia-design',
      });
      const imported = outcome.assets[0];
      if (!imported) {
        setMediaError(outcome.warnings[0] ?? 'No se pudo importar el diseño a Medios.');
        return;
      }
      const ok = store.update(
        (current) => addAsset(current, imported),
        { notice: `Diseño agregado a Medios: ${imported.label}.` },
      );
      if (ok) {
        setMediaSent(imported.label);
        setMediaAsset(imported);
      } else {
        setMediaError(store.state.error ?? 'No se pudo agregar el diseño al proyecto.');
      }
    } catch (reason) {
      setMediaError(reason instanceof Error ? reason.message : 'No se pudo enviar a Medios.');
    } finally {
      setMediaBusy(false);
    }
  }

  function mountInTimeline(): void {
    if (!mediaAsset) return;
    const ok = store.update(
      (current) =>
        addClipFromAsset(current, mediaAsset, { atFrame: store.state.playheadFrame }).project,
      { notice: `Diseño montado en la timeline: ${mediaAsset.label}.` },
    );
    if (!ok) {
      setMediaError(store.state.error ?? 'No se pudo montar el diseño en la timeline.');
      return;
    }
    onClose();
    onNavigate?.('editor');
  }

  async function saveVideo(): Promise<void> {
    if (!video) return;
    setVideoError(null);
    try {
      const path = await store.service.saveDesignVideo(
        video.base64,
        brief.trim().slice(0, 60) || `diseno-${system?.id ?? 'olyvia'}`,
      );
      if (path) {
        setVideoSaved(path);
        store.setNotice('MP4 del diseño guardado.');
      }
    } catch (reason) {
      setVideoError(reason instanceof Error ? reason.message : 'No se pudo guardar el MP4.');
    }
  }

  async function savePng(): Promise<void> {
    if (!png) return;
    setPngError(null);
    try {
      const path = await store.service.saveDesignPng(
        png.base64,
        brief.trim().slice(0, 60) || `diseno-${system?.id ?? 'olyvia'}`,
      );
      if (path) {
        setPngSaved(path);
        store.setNotice('PNG del diseño guardado.');
      }
    } catch (reason) {
      setPngError(reason instanceof Error ? reason.message : 'No se pudo guardar el PNG.');
    }
  }

  async function copy(): Promise<void> {
    if (!result) return;
    const copied = await writeClipboard(result.html);
    store.setNotice(copied ? 'HTML del diseño copiado.' : 'No se pudo copiar el HTML.');
  }

  return (
    <div className="design-generator-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <div
        ref={dialogRef}
        className="design-generator"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy}
      >
        <header className="design-generator-head">
          <div>
            <span className="design-detail-kicker">
              Open Design · {system.name}
            </span>
            <h2 id={titleId}>Crear diseño</h2>
            <p>
              Un brief, un sistema y las reglas de craft. El proveedor de Ajustes → IA
              devuelve HTML autocontenido, sin scripts ni recursos externos.
            </p>
          </div>
          <button
            type="button"
            className="design-generator-close"
            aria-label="Cerrar generador de diseño"
            onClick={onClose}
            disabled={busy}
          >
            <Icon name="close" size={14} />
          </button>
        </header>

        {result ? (
          <div className="design-generator-preview">
            <div className="design-generator-preview-bar">
              <span>
                {FORMATS.find((item) => item.id === result.format)?.label ?? result.format} ·{' '}
                {result.model}
              </span>
              <div>
                <button type="button" className="ghost icon-text" onClick={() => void copy()}>
                  <Icon name="copy" size={14} />
                  <span>Copiar HTML</span>
                </button>
                <button
                  type="button"
                  className="ghost icon-text"
                  onClick={() => void copyHandoff()}
                >
                  <Icon name="external" size={14} />
                  <span>Copiar handoff</span>
                </button>
                <button
                  type="button"
                  className="ghost icon-text"
                  onClick={() => {
                    setResult(null);
                    setSaved(null);
                    setPng(null);
                    setPngSaved(null);
                    setPngError(null);
                    setVideo(null);
                    setVideoSaved(null);
                    setVideoError(null);
                    setPdf(null);
                    setPdfSaved(null);
                    setPdfError(null);
                    setCritique(null);
                    setCritiqueError(null);
                    setPatchError(null);
                    setError(null);
                  }}
                >
                  <Icon name="refresh" size={14} />
                  <span>Ajustar brief</span>
                </button>
                <button
                  type="button"
                  className="ghost icon-text"
                  onClick={() => void critiqueDesign()}
                  disabled={critiqueBusy}
                >
                  <Icon name="eye" size={14} />
                  <span>{critiqueBusy ? 'Revisando…' : 'Criticar diseño'}</span>
                </button>
                <button
                  type="button"
                  className="ghost icon-text"
                  onClick={() => void renderPng()}
                  disabled={pngBusy}
                >
                  <Icon name="effects" size={14} />
                  <span>{pngBusy ? 'Rasterizando…' : 'Renderizar PNG'}</span>
                </button>
                {png ? (
                  <button type="button" className="ghost icon-text" onClick={() => void savePng()}>
                    <Icon name="save" size={14} />
                    <span>Guardar PNG</span>
                  </button>
                ) : null}
                {result.format === 'deck' ? (
                  <button
                    type="button"
                    className="ghost icon-text"
                    onClick={() => void exportPdf()}
                    disabled={pdfBusy}
                  >
                    <Icon name="export" size={14} />
                    <span>{pdfBusy ? 'Armando PDF…' : 'Exportar PDF'}</span>
                  </button>
                ) : null}
                {pdf ? (
                  <button type="button" className="primary icon-text" onClick={() => void savePdf()}>
                    <Icon name="save" size={14} />
                    <span>Guardar PDF</span>
                  </button>
                ) : null}
                <button
                  type="button"
                  className="ghost icon-text"
                  onClick={() => void createVideo()}
                  disabled={videoBusy}
                >
                  <Icon name="film" size={14} />
                  <span>{videoBusy ? 'Grabando…' : `Crear video ${videoSeconds} s`}</span>
                </button>
                {video ? (
                  <button type="button" className="primary icon-text" onClick={() => void saveVideo()}>
                    <Icon name="save" size={14} />
                    <span>Guardar MP4</span>
                  </button>
                ) : (
                  <button type="button" className="ghost icon-text" onClick={() => void save()}>
                    <Icon name="save" size={14} />
                    <span>Guardar HTML</span>
                  </button>
                )}
              </div>
            </div>
            <div className="design-generated-frame">
              <iframe
                title={`Diseño generado con ${system.name}`}
                sandbox=""
                srcDoc={result.html}
              />
            </div>
            <form
              className="design-patch"
              onSubmit={(event) => {
                event.preventDefault();
                void applyPatch();
              }}
            >
              <label htmlFor="design-patch-input">Ajustar con una instrucción</label>
              <div>
                <input
                  id="design-patch-input"
                  value={patchInstruction}
                  maxLength={500}
                  disabled={patchBusy || busy}
                  placeholder="Ej.: cambiá el titular principal y agregá una sección de precios"
                  onChange={(event) => setPatchInstruction(event.target.value)}
                />
                <button
                  type="submit"
                  className="small primary icon-text"
                  disabled={patchBusy || busy || patchInstruction.trim().length < 3}
                >
                  <Icon name="sparkles" size={14} />
                  <span>{patchBusy ? 'Aplicando…' : 'Aplicar cambio'}</span>
                </button>
              </div>
              <small>Reenvía el HTML actual y la instrucción al proveedor configurado.</small>
            </form>
            {patchError ? (
              <p className="design-inline-error" role="alert">
                {patchError}
              </p>
            ) : null}
            {critique ? (
              <section className="design-critique" aria-label="Revisión de diseño">
                <header>
                  <span className="design-detail-kicker">
                    Revisión · {critique.model}
                  </span>
                  <h3>Qué revisar antes de entregar</h3>
                </header>
                <p>{critique.critique}</p>
                <div className="design-image-actions">
                  <button
                    type="button"
                    className="small primary icon-text"
                    onClick={() => void fixWithCritique()}
                    disabled={busy}
                  >
                    <Icon name="sparkles" size={14} />
                    <span>{busy ? 'Corrigiendo…' : 'Corregir con la crítica'}</span>
                  </button>
                </div>
              </section>
            ) : null}
            {critiqueError ? (
              <p className="design-inline-error" role="alert">
                {critiqueError}
              </p>
            ) : null}
            {pdf ? (
              <div className="design-generated-pdf">
                <p>
                  PDF {pdf.width}×{pdf.height} · {pdf.pages} página(s) ·{' '}
                  {(pdf.bytes / 1024).toFixed(0)} KB
                </p>
              </div>
            ) : null}
            {pdfSaved ? (
              <p className="design-generator-saved" role="status">
                PDF guardado en <strong>{pdfSaved}</strong>
              </p>
            ) : null}
            {pdfError ? (
              <p className="design-inline-error" role="alert">
                {pdfError}
              </p>
            ) : null}
            {png ? (
              <div className="design-generated-png">
                <img
                  src={png.dataUrl}
                  alt={`PNG rasterizado de ${system.name} a ${png.width}×${png.height}`}
                />
                <p>
                  PNG {png.width}×{png.height} listo. Se guardó con el rasterizador del
                  WebView2, sin scripts.
                </p>
                <button
                  type="button"
                  className="small ghost"
                  disabled={mediaBusy || !store.state.project}
                  onClick={() => void sendToMedia('png')}
                >
                  {mediaBusy ? 'Enviando…' : 'Enviar PNG a Medios'}
                </button>
              </div>
            ) : null}
            {video ? (
              <div className="design-generated-video">
                <video
                  controls
                  loop
                  playsInline
                  src={video.url}
                  aria-label={`Video generado de ${system.name}`}
                />
                <p>
                  MP4 {video.width}×{video.height} · {video.durationSeconds} s · {video.fps} fps
                  {video.scenes > 1 ? ` · ${video.scenes} escenas` : ''} · VP9/WebCodecs, sin
                  Chrome.
                </p>
                <button
                  type="button"
                  className="small ghost"
                  disabled={mediaBusy || !store.state.project}
                  onClick={() => void sendToMedia('mp4')}
                >
                  {mediaBusy ? 'Enviando…' : 'Enviar MP4 a Medios'}
                </button>
              </div>
            ) : null}
            {mediaSent ? (
              <p className="design-generator-saved" role="status">
                Agregado a Medios como <strong>{mediaSent}</strong>.
              </p>
            ) : null}
            {mediaAsset ? (
              <button type="button" className="small primary icon-text" onClick={mountInTimeline}>
                <Icon name="editor" size={14} />
                <span>Montar en la timeline</span>
              </button>
            ) : null}
            {mediaError ? (
              <p className="design-inline-error" role="alert">
                {mediaError}
              </p>
            ) : null}
            {videoSaved ? (
              <p className="design-generator-saved" role="status">
                MP4 guardado en <strong>{videoSaved}</strong>
              </p>
            ) : null}
            {videoError ? (
              <p className="design-inline-error" role="alert">
                {videoError}
              </p>
            ) : null}
            {pngSaved ? (
              <p className="design-generator-saved" role="status">
                PNG guardado en <strong>{pngSaved}</strong>
              </p>
            ) : null}
            {saved ? (
              <p className="design-generator-saved" role="status">
                HTML guardado en <strong>{saved}</strong>
              </p>
            ) : null}
            {pngError ? (
              <p className="design-inline-error" role="alert">
                {pngError}
              </p>
            ) : null}
            {error ? (
              <p className="design-inline-error" role="alert">
                {error}
              </p>
            ) : null}
            <footer className="design-generator-foot">
              <span>
                El HTML queda en tu equipo; el PNG se rasteriza localmente con html2canvas.
              </span>
              <button type="button" className="ghost" onClick={onClose}>
                Cerrar
              </button>
            </footer>
          </div>
        ) : (
          <div className="design-generator-form">
            <div className="design-generator-system">
              <span className="design-generator-swatches" aria-hidden="true">
                {['bg', 'surface', 'accent', 'fg'].map((key) =>
                  system.colors[key] ? (
                    <i key={key} style={{ background: system.colors[key] }} />
                  ) : null,
                )}
              </span>
              <div>
                <strong>{system.name}</strong>
                <small>
                  {recipe
                    ? `Receta: ${recipe.title}`
                    : (system.fonts.display ?? system.fonts.body ?? 'Tipografía del sistema')}
                </small>
              </div>
            </div>

            {recipe ? (
              <p className="design-generator-recipe" role="status">
                La receta aporta estructura, secciones y contrato de salida; el sistema aporta
                color y tipografía.
              </p>
            ) : null}

            <div className="design-generator-formats" role="group" aria-label="Formato del diseño">
              {FORMATS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={format === item.id}
                  className={format === item.id ? 'active' : ''}
                  onClick={() => setFormat(item.id)}
                  disabled={busy}
                >
                  <strong>{item.label}</strong>
                  <span>{item.hint}</span>
                </button>
              ))}
            </div>

            <div className="design-generator-video-options">
              <span>Video</span>
              <div role="group" aria-label="Duración del video">
                {[3, 5, 8].map((seconds) => (
                  <button
                    key={seconds}
                    type="button"
                    aria-pressed={videoSeconds === seconds}
                    className={videoSeconds === seconds ? 'active' : ''}
                    onClick={() => setVideoSeconds(seconds)}
                    disabled={busy}
                  >
                    {seconds} s
                  </button>
                ))}
              </div>
              <div role="group" aria-label="FPS del video">
                {[15, 30].map((fps) => (
                  <button
                    key={fps}
                    type="button"
                    aria-pressed={videoFps === fps}
                    className={videoFps === fps ? 'active' : ''}
                    onClick={() => setVideoFps(fps)}
                    disabled={busy}
                  >
                    {fps} fps
                  </button>
                ))}
              </div>
            </div>

            <label className="design-generator-brief">
              <span>Brief</span>
              <textarea
                ref={textareaRef}
                rows={5}
                maxLength={BRIEF_LIMIT}
                value={brief}
                disabled={busy}
                placeholder="Ej.: landing para un estudio de edición que vende piezas cortas a marcas. Público: equipos de marketing. Debe explicar el servicio, mostrar tres ejemplos y cerrar con una llamada a reservar una llamada."
                onChange={(event) => setBrief(event.target.value)}
              />
              <small>
                {brief.length.toLocaleString('es-AR')} / {BRIEF_LIMIT.toLocaleString('es-AR')}{' '}
                caracteres · sé específico con público, oferta y acción.
              </small>
            </label>

            <div className="design-directions-actions">
              <button
                type="button"
                className="ghost icon-text"
                aria-expanded={discoveryOpen}
                onClick={() => setDiscoveryOpen((open) => !open)}
                disabled={busy}
              >
                <Icon name="chat" size={14} />
                <span>Construir brief</span>
              </button>
              <button
                type="button"
                className="ghost icon-text"
                onClick={() => void proposeDirections()}
                disabled={busy || directionsBusy}
              >
                <Icon name="layers" size={14} />
                <span>{directionsBusy ? 'Proponiendo…' : 'Proponer 3 direcciones'}</span>
              </button>
              {selectedDirection ? (
                <span className="design-direction-selected">
                  Dirección activa: <strong>{selectedDirection.name}</strong>
                </span>
              ) : null}
            </div>
            {discoveryOpen ? (
              <div className="design-discovery" aria-label="Construir brief">
                <label>
                  <span>Qué es</span>
                  <input
                    value={discovery.what}
                    maxLength={240}
                    placeholder="Landing de un estudio de edición de video"
                    onChange={(event) =>
                      setDiscovery((current) => ({ ...current, what: event.target.value }))
                    }
                  />
                </label>
                <label>
                  <span>Para quién</span>
                  <input
                    value={discovery.audience}
                    maxLength={240}
                    placeholder="Equipos de marketing de marcas medianas"
                    onChange={(event) =>
                      setDiscovery((current) => ({ ...current, audience: event.target.value }))
                    }
                  />
                </label>
                <label>
                  <span>Qué debe lograr</span>
                  <input
                    value={discovery.goal}
                    maxLength={240}
                    placeholder="Mostrar tres ejemplos y reservar una llamada"
                    onChange={(event) =>
                      setDiscovery((current) => ({ ...current, goal: event.target.value }))
                    }
                  />
                </label>
                <label>
                  <span>Tono y restricciones</span>
                  <input
                    value={discovery.tone}
                    maxLength={240}
                    placeholder="Profesional, sin stock genérico, acento coral"
                    onChange={(event) =>
                      setDiscovery((current) => ({ ...current, tone: event.target.value }))
                    }
                  />
                </label>
                <button
                  type="button"
                  className="small primary"
                  onClick={applyDiscovery}
                  disabled={!discovery.what.trim() || !discovery.audience.trim() || !discovery.goal.trim()}
                >
                  Usar este brief
                </button>
              </div>
            ) : null}
            {directionsError ? (
              <p className="design-inline-error" role="alert">
                {directionsError}
              </p>
            ) : null}
            {directions.length > 0 ? (
              <div className="design-directions" aria-label="Direcciones propuestas">
                {directions.map((direction) => (
                  <article
                    key={direction.name}
                    className={
                      selectedDirection?.name === direction.name
                        ? 'design-direction-card active'
                        : 'design-direction-card'
                    }
                  >
                    <div className="design-direction-swatches" aria-hidden="true">
                      <i style={{ background: direction.bg }} />
                      <i style={{ background: direction.surface }} />
                      <i style={{ background: direction.fg }} />
                      <i style={{ background: direction.accent }} />
                    </div>
                    <h4>{direction.name}</h4>
                    <p>{direction.concept}</p>
                    <small>
                      {direction.displayFont} + {direction.bodyFont}
                    </small>
                    <p className="design-direction-why">{direction.why}</p>
                    <button
                      type="button"
                      className="small"
                      aria-pressed={selectedDirection?.name === direction.name}
                      onClick={() => setSelectedDirection(direction)}
                      disabled={busy}
                    >
                      {selectedDirection?.name === direction.name
                        ? 'Dirección elegida'
                        : 'Usar esta dirección'}
                    </button>
                    <button
                      type="button"
                      className="small ghost"
                      onClick={() => applyDirectionPalette(direction)}
                      disabled={busy}
                    >
                      Aplicar paleta
                    </button>
                  </article>
                ))}
              </div>
            ) : null}

            <label className="design-generator-craft">
              <input
                type="checkbox"
                checked={includeCraft}
                disabled={busy}
                onChange={(event) => setIncludeCraft(event.target.checked)}
              />
              <span>
                Incluir reglas de craft sugeridas
                {system.craft.suggested.length > 0
                  ? ` (${system.craft.suggested.slice(0, 2).join(' · ')})`
                  : ' (este sistema no declara reglas)'}
              </span>
            </label>

            {warning ? (
              <p className="design-generator-warning" role="status">
                {warning}
              </p>
            ) : null}
            {error ? (
              <p className="design-inline-error" role="alert">
                {error}
              </p>
            ) : null}

            <footer className="design-generator-foot">
              <span>
                Usa el proveedor configurado en Ajustes → IA. La llamada puede consumir cuota.
              </span>
              <div>
                <button type="button" className="ghost" onClick={onClose} disabled={busy}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className="primary icon-text"
                  onClick={() => void generate()}
                  disabled={busy}
                >
                  <Icon name="sparkles" size={14} />
                  <span>{busy ? 'Generando…' : 'Generar diseño'}</span>
                </button>
              </div>
            </footer>
          </div>
        )}
      </div>
    </div>
  );
}
