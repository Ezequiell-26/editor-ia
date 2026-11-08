import { useEffect, useMemo, useRef, useState } from 'react';
import type { AudioScopeData } from '../../services/project-service';
import { usePlayheadFrame, useProjectStore } from '../../state/project-store';
import { audioScopeCandidatesAtPlayhead } from '../../state/playhead-audio-scope';

/**
 * Scopes de audio del material seleccionado (port de los audioscopes de
 * Kdenlive: oscilograma + espectro + espectrograma). Los datos los calcula
 * Rust (`audio_scope_analyze_asset`); acá sólo se dibujan en canvas.
 *
 * Dos modos: el material completo del asset, o una ventana de ±2,5 s alrededor
 * del playhead sobre el clip que lo contiene (mapeo timeline→fuente igual que
 * la preview). El modo playhead mide el audio FUENTE del clip: no aplica
 * mutes, fades, ganancia ni efectos — la UI lo declara.
 */
export function AudioScopesPanel() {
  const store = useProjectStore();
  const project = store.state.project;
  const playheadFrame = usePlayheadFrame();
  const assets = (project?.assets ?? []).filter(
    (asset) =>
      (asset.kind === 'video' || asset.kind === 'audio') &&
      (asset.status === 'ready' || asset.status === 'unverified'),
  );
  const [mode, setMode] = useState<'asset' | 'playhead'>('asset');
  const [assetId, setAssetId] = useState<string>('');
  const [clipPick, setClipPick] = useState(0);
  const [data, setData] = useState<AudioScopeData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [windowNote, setWindowNote] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const selected = assetId || assets[0]?.id || '';
  const candidates = useMemo(
    () => (project && mode === 'playhead' ? audioScopeCandidatesAtPlayhead(project, playheadFrame) : []),
    [project, playheadFrame, mode],
  );
  const target = candidates[Math.min(clipPick, candidates.length - 1)] ?? null;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !data) return;
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);

    // OSILOGRAMA (tercio superior): min/max por bucket.
    const waveH = height * 0.3;
    ctx.fillStyle = '#58c4dc';
    const buckets = data.waveform.length || 1;
    for (let i = 0; i < buckets; i += 1) {
      const [min, max] = data.waveform[i] ?? [0, 0];
      const x = (i / buckets) * width;
      const y1 = waveH / 2 - max * (waveH / 2);
      const y2 = waveH / 2 - min * (waveH / 2);
      ctx.fillRect(x, y1, Math.max(1, width / buckets), Math.max(1, y2 - y1));
    }

    // ESPECTRO (tercio medio): barras en dBFS.
    const specTop = waveH + 8;
    const specH = height * 0.25;
    ctx.fillStyle = '#9ece6a';
    const bins = data.spectrum.length || 1;
    for (let i = 0; i < bins; i += 1) {
      const db = data.spectrum[i] ?? -120;
      const level = Math.max(0, Math.min(1, (db + 120) / 120));
      const h = level * specH;
      ctx.fillRect(
        (i / bins) * width,
        specTop + specH - h,
        Math.max(1, width / bins),
        h,
      );
    }

    // ESPECTROGRAMA (tercio inferior): dB → color (oscuro→naranja).
    const specBottom = specTop + specH + 8;
    const specH2 = height - specBottom;
    const { spectrogramCols: cols, spectrogramRows: rows, spectrogram } = data;
    if (cols > 0 && rows > 0) {
      const cellW = width / cols;
      const cellH = specH2 / rows;
      for (let c = 0; c < cols; c += 1) {
        for (let r = 0; r < rows; r += 1) {
          const db = spectrogram[c * rows + r] ?? -120;
          const t = Math.max(0, Math.min(1, (db + 120) / 120));
          // r=0 es agudo (última fila FFT); acá fila mayor = grave→agudo abajo→arriba.
          const y = specBottom + (rows - 1 - r) * cellH;
          const shade = Math.round(20 + t * 235);
          ctx.fillStyle = `rgb(${shade},${Math.round(30 + t * 120)},${Math.round(60 - t * 40)})`;
          ctx.fillRect(c * cellW, y, Math.ceil(cellW), Math.ceil(cellH));
        }
      }
    }
  }, [data]);

  const analyze = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setWindowNote(null);
    try {
      if (mode === 'playhead') {
        if (!target) {
          setError('No hay ningún clip de video o audio bajo el playhead.');
          setData(null);
          return;
        }
        setData(
          await store.service.audioScopeAnalyzeAsset(target.assetId, {
            startSeconds: target.startSeconds,
            durationSeconds: target.durationSeconds,
          }),
        );
        setWindowNote(
          `Clip «${target.clipLabel}» · ventana de ${target.durationSeconds.toFixed(1)} s ` +
            `del material fuente (playhead a ${target.centerSeconds.toFixed(2)} s). ` +
            'Mide el audio fuente: no aplica mutes, fades ni efectos del clip.',
        );
      } else {
        if (!selected) return;
        setData(await store.service.audioScopeAnalyzeAsset(selected));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'no se pudo analizar el audio');
      setData(null);
    } finally {
      setBusy(false);
    }
  };

  const canAnalyze = mode === 'playhead' ? target !== null : selected !== '';

  return (
    <article className="mixer-scopes" aria-label="Scopes de audio">
      <header className="mixer-scopes-head">
        <h3>Scopes de audio</h3>
        <select
          aria-label="Qué analizar"
          value={mode}
          onChange={(event) => {
            setMode(event.target.value as 'asset' | 'playhead');
            setData(null);
            setWindowNote(null);
            setError(null);
          }}
        >
          <option value="asset">Material completo</option>
          <option value="playhead">Ventana del playhead</option>
        </select>
        {mode === 'asset' && assets.length > 0 ? (
          <select
            aria-label="Material a analizar"
            value={selected}
            onChange={(event) => {
              setAssetId(event.target.value);
              setData(null);
            }}
          >
            {assets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.label}
              </option>
            ))}
          </select>
        ) : null}
        {mode === 'playhead' && candidates.length > 1 ? (
          <select
            aria-label="Clip bajo el playhead"
            value={String(Math.min(clipPick, candidates.length - 1))}
            onChange={(event) => setClipPick(Number(event.target.value))}
          >
            {candidates.map((candidate, index) => (
              <option key={candidate.clipId} value={index}>
                {candidate.clipLabel}
              </option>
            ))}
          </select>
        ) : null}
        <button type="button" disabled={!canAnalyze || busy} onClick={() => void analyze()}>
          {busy ? 'Analizando…' : 'Analizar'}
        </button>
      </header>
      {mode === 'asset' && assets.length === 0 ? (
        <p className="mixer-meta">No hay materiales de audio o video listos en el proyecto.</p>
      ) : null}
      {mode === 'playhead' && candidates.length === 0 ? (
        <p className="mixer-meta">
          Mové el playhead sobre un clip de video o audio para analizar su audio.
        </p>
      ) : null}
      {error ? <p className="mixer-error">{error}</p> : null}
      <canvas
        ref={canvasRef}
        width={640}
        height={220}
        aria-label="Oscilograma, espectro y espectrograma del audio"
      />
      {windowNote ? <p className="mixer-meta">{windowNote}</p> : null}
      {data && !windowNote ? (
        <p className="mixer-meta">
          {data.durationSeconds.toFixed(1)} s · {data.sampleRate} Hz · oscilograma /
          espectro / espectrograma
        </p>
      ) : null}
    </article>
  );
}
