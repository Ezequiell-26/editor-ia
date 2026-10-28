import { useState } from 'react';
import type { ViewId } from '../../app/navigation';
import { Icon } from '../../components/Icon';
import { ViewToolbar } from '../../components/ViewToolbar';
import type { CreatorOutput } from '../../services/project-service';
import { useProjectStore } from '../../state/project-store';

function stemOf(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? 'video';
  return name.replace(/\.[^.]+$/, '') || 'video';
}

function dirOf(path: string): string {
  const index = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
  return index > 0 ? path.slice(0, index) : '';
}

function joinPath(dir: string, name: string): string {
  if (!dir) return name;
  return `${dir.replace(/[\\/]+$/, '')}\\${name}`;
}

const ASPECTS = [
  { key: 'vertical' as const, label: '9:16 vertical', hint: 'TikTok · Shorts · Reels' },
  { key: 'horizontal' as const, label: '16:9 horizontal', hint: 'YouTube largo' },
  { key: 'square' as const, label: '1:1 cuadrado', hint: 'Feed' },
];

export function CreatorView({ onNavigate }: { readonly onNavigate: (id: ViewId) => void }) {
  const store = useProjectStore();
  const service = store.service;
  const [inputPath, setInputPath] = useState(() => {
    try {
      const pending = window.sessionStorage.getItem('editor-ia.creator-input');
      if (pending) {
        window.sessionStorage.removeItem('editor-ia.creator-input');
        return pending;
      }
    } catch {
      // sessionStorage no disponible: se elige a mano.
    }
    return '';
  });
  const [outputDir, setOutputDir] = useState('');
  const [brollDir, setBrollDir] = useState('');
  const [hookText, setHookText] = useState('El secreto que nadie te contó');
  const [zoomPercent, setZoomPercent] = useState(10);
  const [soundGain, setSoundGain] = useState(-16);
  const [ctaText, setCtaText] = useState('Enlace en la biografía');
  const [ctaUrl, setCtaUrl] = useState('');
  const [ctaSeconds, setCtaSeconds] = useState(4);
  const [addQr, setAddQr] = useState(true);
  const [aspects, setAspects] = useState<Record<'vertical' | 'horizontal' | 'square', boolean>>({
    vertical: true,
    horizontal: true,
    square: true,
  });
  const [intervalSeconds, setIntervalSeconds] = useState(5);
  const [clipSeconds, setClipSeconds] = useState(1.75);
  const [maxInsertions, setMaxInsertions] = useState(12);
  const [subtitleName, setSubtitleName] = useState('');
  const [subtitleText, setSubtitleText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<CreatorOutput[]>([]);
  const [error, setError] = useState<string | null>(null);

  const baseDir = outputDir || (inputPath ? dirOf(inputPath) : '');
  const stem = inputPath ? stemOf(inputPath) : 'video';

  async function chooseInput(): Promise<void> {
    const picked = await service.chooseVideoFile('Elegir video para el módulo Creador');
    if (picked) setInputPath(picked);
  }

  async function chooseOutput(): Promise<void> {
    const picked = await service.chooseDownloadDirectory();
    if (picked) setOutputDir(picked);
  }

  async function chooseBroll(): Promise<void> {
    const picked = await service.chooseDownloadDirectory();
    if (picked) setBrollDir(picked);
  }

  function addResults(outputs: readonly CreatorOutput[]): void {
    setResults((current) => [...outputs, ...current].slice(0, 12));
  }

  async function runHook(): Promise<void> {
    if (!inputPath) return;
    setBusy('hook');
    setError(null);
    try {
      const output = await service.creatorInjectHook({
        inputPath,
        outputPath: joinPath(baseDir, `${stem}-hook.mp4`),
        hookText,
        zoomPercent,
        soundGainDb: soundGain,
      });
      addResults([output]);
      store.setNotice('Hook generado con zoom, texto y whoosh.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'no se pudo generar el hook');
    } finally {
      setBusy(null);
    }
  }

  async function runMulti(): Promise<void> {
    if (!inputPath) return;
    const selected = ASPECTS.filter((aspect) => aspects[aspect.key]).map((aspect) => aspect.key);
    if (selected.length === 0) {
      setError('Elegí al menos una relación de aspecto.');
      return;
    }
    setBusy('multi');
    setError(null);
    try {
      const outputs = await service.creatorExportMultiAspect({
        inputPath,
        outputDir: baseDir,
        aspects: selected,
      });
      addResults(outputs);
      store.setNotice(`${outputs.length} variantes exportadas en paralelo.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'no se pudo exportar');
    } finally {
      setBusy(null);
    }
  }

  async function runCta(): Promise<void> {
    if (!inputPath) return;
    setBusy('cta');
    setError(null);
    try {
      const output = await service.creatorInjectCta({
        inputPath,
        outputPath: joinPath(baseDir, `${stem}-cta.mp4`),
        ctaText,
        url: ctaUrl,
        ctaSeconds,
        addQr,
      });
      addResults([output]);
      store.setNotice('CTA inyectado con banner y QR.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'no se pudo inyectar el CTA');
    } finally {
      setBusy(null);
    }
  }

  async function runBroll(): Promise<void> {
    if (!inputPath || !brollDir) return;
    setBusy('broll');
    setError(null);
    try {
      const output = await service.creatorInterleaveBroll({
        inputPath,
        brollDir,
        outputPath: joinPath(baseDir, `${stem}-broll.mp4`),
        intervalSeconds,
        clipSeconds,
        maxInsertions,
      });
      addResults([output]);
      store.setNotice('B-roll intercalado sin cortar el audio principal.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'no se pudo intercalar el B-roll');
    } finally {
      setBusy(null);
    }
  }

  async function chooseSubtitle(): Promise<void> {
    const picked = await service.chooseSubtitleFile();
    if (!picked) return;
    setSubtitleName(picked.name);
    setSubtitleText(picked.text);
  }

  async function runChapters(): Promise<void> {
    if (!inputPath) return;
    setBusy('chapters');
    setError(null);
    try {
      const outputs = await service.creatorSplitChapters({ inputPath, outputDir: baseDir });
      addResults(outputs);
      store.setNotice(`${outputs.length} capítulo(s) exportados como clips independientes.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'no se pudieron dividir los capítulos');
    } finally {
      setBusy(null);
    }
  }

  async function runBurn(): Promise<void> {
    if (!inputPath || !subtitleText.trim()) return;
    setBusy('burn');
    setError(null);
    try {
      const output = await service.creatorBurnSubtitles({
        inputPath,
        outputPath: joinPath(baseDir, `${stem}-subs.mp4`),
        subtitleText,
      });
      addResults([output]);
      store.setNotice('Subtítulos quemados con estilo legible de alto contraste.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'no se pudieron quemar los subtítulos');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="view creator-view">
      <ViewToolbar
        label="Creador"
        actions={
          <button type="button" className="ghost icon-text" onClick={() => onNavigate('assets')}>
            <Icon name="assets" size={14} />
            <span>Ir a Medios</span>
          </button>
        }
      />
      <div className="creator-intro">
        <h1>Herramientas de creador</h1>
        <p>
          Hooks de 3 segundos, exportación simultánea 9:16 / 16:9 / 1:1, CTA con QR offline, B-roll
          automático, división por capítulos y subtítulos quemados. Todo con FFmpeg local, sin subir
          el material.
        </p>
      </div>

      <div className="card creator-source">
        <div className="inspector-grid">
          <label className="field wide">
            <span>Video de entrada</span>
            <input
              readOnly
              value={inputPath}
              placeholder="Elegí un video…"
              aria-label="Video de entrada"
            />
          </label>
          <label className="field wide">
            <span>Carpeta de salida</span>
            <input
              readOnly
              value={baseDir}
              placeholder="La carpeta del video o una elegida"
              aria-label="Carpeta de salida"
            />
          </label>
        </div>
        <div className="actions">
          <button type="button" className="small" onClick={() => void chooseInput()}>
            Elegir video…
          </button>
          <button type="button" className="small ghost" onClick={() => void chooseOutput()}>
            Elegir carpeta…
          </button>
        </div>
      </div>

      {error ? (
        <div className="notice notice-warning" role="alert">
          {error}
        </div>
      ) : null}

      <div className="creator-grid">
        <div className="card creator-card">
          <p className="eyebrow">Módulo 1</p>
          <h3>Hook de 3 segundos</h3>
          <p className="fine-print">
            Zoom progresivo, texto centrado con fade y whoosh sintetizado en el audio.
          </p>
          <label className="field">
            <span>Texto gancho</span>
            <textarea
              rows={2}
              maxLength={120}
              value={hookText}
              onChange={(event) => setHookText(event.target.value)}
            />
          </label>
          <div className="inspector-grid">
            <label className="field">
              <span>Zoom (%)</span>
              <input
                type="number"
                min={2}
                max={25}
                value={zoomPercent}
                onChange={(event) => setZoomPercent(Number(event.target.value))}
              />
            </label>
            <label className="field">
              <span>Whoosh (dB)</span>
              <input
                type="number"
                min={-36}
                max={-6}
                value={soundGain}
                onChange={(event) => setSoundGain(Number(event.target.value))}
              />
            </label>
          </div>
          <button
            type="button"
            className="primary"
            disabled={!inputPath || busy !== null}
            onClick={() => void runHook()}
          >
            {busy === 'hook' ? 'Generando…' : 'Generar hook'}
          </button>
        </div>

        <div className="card creator-card">
          <p className="eyebrow">Módulo 2</p>
          <h3>Exportar a 3 formatos</h3>
          <p className="fine-print">
            Tres encodes en paralelo, audio copiado sin re-codificar cuando el contenedor lo
            permite.
          </p>
          <div className="creator-check-list">
            {ASPECTS.map((aspect) => (
              <label className="check" key={aspect.key}>
                <input
                  type="checkbox"
                  checked={aspects[aspect.key]}
                  onChange={(event) =>
                    setAspects((current) => ({
                      ...current,
                      [aspect.key]: event.target.checked,
                    }))
                  }
                />
                <span>
                  {aspect.label} <small>{aspect.hint}</small>
                </span>
              </label>
            ))}
          </div>
          <button
            type="button"
            className="primary"
            disabled={!inputPath || busy !== null}
            onClick={() => void runMulti()}
          >
            {busy === 'multi' ? 'Exportando…' : 'Exportar variantes'}
          </button>
        </div>

        <div className="card creator-card">
          <p className="eyebrow">Módulo 3</p>
          <h3>CTA de cierre + QR</h3>
          <p className="fine-print">
            Banner inferior en los últimos segundos y QR generado en Rust, sin servicios externos.
          </p>
          <label className="field">
            <span>Texto del CTA</span>
            <input
              type="text"
              value={ctaText}
              maxLength={120}
              onChange={(event) => setCtaText(event.target.value)}
            />
          </label>
          <label className="field">
            <span>URL o texto del QR</span>
            <input
              type="text"
              value={ctaUrl}
              placeholder="https://tusitio.com/afiliado"
              onChange={(event) => setCtaUrl(event.target.value)}
            />
          </label>
          <div className="inspector-grid">
            <label className="field">
              <span>Duración (s)</span>
              <input
                type="number"
                min={3}
                max={5}
                step={0.5}
                value={ctaSeconds}
                onChange={(event) => setCtaSeconds(Number(event.target.value))}
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={addQr}
                onChange={(event) => setAddQr(event.target.checked)}
              />
              <span>Incluir QR</span>
            </label>
          </div>
          <button
            type="button"
            className="primary"
            disabled={!inputPath || busy !== null || (addQr && !ctaUrl.trim())}
            onClick={() => void runCta()}
          >
            {busy === 'cta' ? 'Inyectando…' : 'Inyectar CTA'}
          </button>
        </div>

        <div className="card creator-card">
          <p className="eyebrow">Módulo 4</p>
          <h3>B-roll rompe-monotonía</h3>
          <p className="fine-print">
            Reemplaza tramos de video por clips de apoyo sin cortar el audio principal; la duración
            total se conserva.
          </p>
          <label className="field">
            <span>Carpeta de B-roll</span>
            <input
              readOnly
              value={brollDir}
              placeholder="Elegí una carpeta con clips…"
              aria-label="Carpeta de B-roll"
            />
          </label>
          <button type="button" className="small ghost" onClick={() => void chooseBroll()}>
            Elegir B-roll…
          </button>
          <div className="inspector-grid">
            <label className="field">
              <span>Cada (s)</span>
              <input
                type="number"
                min={2}
                max={60}
                step={0.5}
                value={intervalSeconds}
                onChange={(event) => setIntervalSeconds(Number(event.target.value))}
              />
            </label>
            <label className="field">
              <span>Clip (s)</span>
              <input
                type="number"
                min={1}
                max={3}
                step={0.25}
                value={clipSeconds}
                onChange={(event) => setClipSeconds(Number(event.target.value))}
              />
            </label>
            <label className="field">
              <span>Máximo</span>
              <input
                type="number"
                min={1}
                max={20}
                value={maxInsertions}
                onChange={(event) => setMaxInsertions(Number(event.target.value))}
              />
            </label>
          </div>
          <button
            type="button"
            className="primary"
            disabled={!inputPath || !brollDir || busy !== null}
            onClick={() => void runBroll()}
          >
            {busy === 'broll' ? 'Intercalando…' : 'Intercalar B-roll'}
          </button>
        </div>

        <div className="card creator-card">
          <p className="eyebrow">Módulo 5</p>
          <h3>Dividir por capítulos</h3>
          <p className="fine-print">
            Lee los capítulos embebidos y exporta cada uno como un MP4 independiente en la carpeta
            de salida.
          </p>
          <p className="fine-print">
            Salida: <strong>{baseDir || 'elegí una carpeta'}</strong>
          </p>
          <button
            type="button"
            className="primary"
            disabled={!inputPath || !baseDir || busy !== null}
            onClick={() => void runChapters()}
          >
            {busy === 'chapters' ? 'Dividiendo…' : 'Dividir capítulos'}
          </button>
        </div>

        <div className="card creator-card">
          <p className="eyebrow">Módulo 6</p>
          <h3>Quemar subtítulos</h3>
          <p className="fine-print">
            Incrusta un SRT o VTT con estilo Segoe UI, contorno negro y margen seguro para móvil.
          </p>
          <label className="field">
            <span>Archivo de subtítulos</span>
            <input
              readOnly
              value={subtitleName}
              placeholder="Elegí un .srt o .vtt…"
              aria-label="Archivo de subtítulos"
            />
          </label>
          <button type="button" className="small ghost" onClick={() => void chooseSubtitle()}>
            Elegir subtítulos…
          </button>
          <button
            type="button"
            className="primary"
            disabled={!inputPath || !subtitleText.trim() || busy !== null}
            onClick={() => void runBurn()}
          >
            {busy === 'burn' ? 'Quemando…' : 'Quemar subtítulos'}
          </button>
        </div>
      </div>

      {results.length > 0 ? (
        <div className="card creator-results">
          <div className="production-card-head">
            <div>
              <p className="eyebrow">Salidas</p>
              <h3>{results.length} archivo(s)</h3>
            </div>
            <button type="button" className="small ghost" onClick={() => setResults([])}>
              Limpiar
            </button>
          </div>
          <ul>
            {results.map((result) => (
              <li key={`${result.kind}-${result.path}`}>
                <div>
                  <strong>{result.path.split(/[\\/]/).pop()}</strong>
                  <small>
                    {result.kind} · {result.width}×{result.height} ·{' '}
                    {result.durationSeconds.toFixed(1)} s ·{' '}
                    {(result.bytes / 1_000_000).toFixed(1)} MB
                  </small>
                </div>
                <button
                  type="button"
                  className="small ghost"
                  onClick={() =>
                    void service
                      .revealOutput(result.path)
                      .catch(() => store.setNotice('No se pudo abrir la carpeta.'))
                  }
                >
                  Ver archivo
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
