import { useEffect, useState } from 'react';
import { Icon } from '../../components/Icon';
import type {
  ChannelProgressEvent,
  YouTubeChannelReport,
  YouTubeChannelVideo,
} from '../../services/project-service';
import { useProjectStore } from '../../state/project-store';

function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('es-AR', { notation: 'compact', maximumFractionDigits: 1 }).format(
    value,
  );
}

function formatFull(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('es-AR').format(value);
}

function formatPercent(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${value.toFixed(1)} %`;
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function FlagChips({ flags }: { readonly flags: readonly string[] }) {
  if (flags.length === 0) return null;
  return (
    <span className="yt-flags">
      {flags.map((flag) => (
        <span key={flag} className="yt-flag">
          {flag}
        </span>
      ))}
    </span>
  );
}

function VideoDetails({ video }: { readonly video: YouTubeChannelVideo }) {
  return (
    <div className="yt-video-details">
      {video.reasons.length > 0 ? (
        <ul className="yt-reasons">
          {video.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}
      {video.thumbnail ? (
        <p className="fine-print">
          Miniatura {video.thumbnail.width}×{video.thumbnail.height} · brillo{' '}
          {video.thumbnail.brightness.toFixed(0)}% · saturación{' '}
          {video.thumbnail.saturation.toFixed(0)}% · contraste{' '}
          {video.thumbnail.contrast.toFixed(0)}% · paleta{' '}
          {video.thumbnail.palette.join(' · ')}
        </p>
      ) : null}
      {video.commentAnalysis ? (
        <div className="yt-comments">
          <p className="fine-print">
            Comentarios: {video.commentAnalysis.analyzed} analizados ·{' '}
            {formatPercent(video.commentAnalysis.positivePercent)} positivos ·{' '}
            {formatPercent(video.commentAnalysis.negativePercent)} negativos
          </p>
          {video.commentAnalysis.keywords.length > 0 ? (
            <p className="yt-keywords">
              {video.commentAnalysis.keywords.map((item) => (
                <span key={item.keyword}>
                  {item.keyword} <small>{item.count}</small>
                </span>
              ))}
            </p>
          ) : null}
          {video.commentAnalysis.topComments.slice(0, 3).map((comment) => (
            <blockquote key={`${comment.author}-${comment.text.slice(0, 20)}`}>
              <p>{comment.text}</p>
              <footer>
                {comment.author || 'Anónimo'} · {formatFull(comment.likes)} me gusta
              </footer>
            </blockquote>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function YouTubeAnalyzerView() {
  const store = useProjectStore();
  const service = store.service;
  const [channelUrl, setChannelUrl] = useState('');
  const [maxVideos, setMaxVideos] = useState(25);
  const [detailCount, setDetailCount] = useState(12);
  const [includeComments, setIncludeComments] = useState(true);
  const [commentVideos, setCommentVideos] = useState(3);
  const [report, setReport] = useState<YouTubeChannelReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ChannelProgressEvent | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let off: (() => void) | null = null;
    void service
      .onChannelAnalysisProgress((event) => {
        if (active) setProgress(event);
      })
      .then((unlisten) => {
        if (active) off = unlisten;
      })
      .catch(() => {
        // Sin eventos, la vista sigue mostrando el estado "Analizando…".
      });
    return () => {
      active = false;
      off?.();
    };
  }, [service]);

  async function analyze(): Promise<void> {
    if (!channelUrl.trim() || busy) return;
    setBusy(true);
    setError(null);
    setProgress({ stage: 'listing', current: 0, total: 1, message: 'Iniciando análisis…' });
    try {
      const result = await service.analyzeYoutubeChannel({
        channelUrl: channelUrl.trim(),
        maxVideos,
        detailCount,
        includeComments,
        commentVideos,
      });
      setReport(result);
      store.setNotice(`Canal analizado: ${result.channelName}.`);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'no se pudo analizar el canal',
      );
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  function openVideo(url: string): void {
    void service.openExternalUrl(url).catch(() => {
      store.setNotice('No se pudo abrir el video en el navegador.');
    });
  }

  const best = report?.videos.find((video) => video.id === report.bestVideoId) ?? report?.videos[0];

  return (
    <section className="view yt-view">
      <header className="view-toolbar">
        <div>
          <h1>Analizador de YouTube</h1>
          <p>
            Metadatos públicos con yt-dlp, miniaturas y comentarios; ranking y patrones
            con heurísticas locales. Sin LLM.
          </p>
        </div>
      </header>

      <div className="yt-layout">
        <div className="card yt-form">
          <div className="production-card-head">
            <div>
              <p className="eyebrow">Canal</p>
              <h3>¿Qué canal querés entender?</h3>
            </div>
          </div>
          <label className="field">
            <span>URL del canal</span>
            <input
              value={channelUrl}
              placeholder="https://www.youtube.com/@tu-canal"
              onChange={(event) => setChannelUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void analyze();
              }}
            />
          </label>
          <p className="fine-print">
            Acepta @handle, /channel/, /c/ y /user/. Se listan hasta 100 videos recientes;
            el detalle se reparte entre los más vistos y los más nuevos.
          </p>
          <div className="yt-form-grid">
            <label className="field">
              <span>Videos a listar</span>
              <select
                value={maxVideos}
                onChange={(event) => setMaxVideos(Number(event.target.value))}
              >
                <option value={12}>12</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </label>
            <label className="field">
              <span>Videos con detalle</span>
              <select
                value={detailCount}
                onChange={(event) => setDetailCount(Number(event.target.value))}
              >
                <option value={8}>8</option>
                <option value={12}>12</option>
                <option value={18}>18</option>
                <option value={24}>24</option>
              </select>
            </label>
            <label className="field">
              <span>Videos con comentarios</span>
              <select
                value={commentVideos}
                onChange={(event) => setCommentVideos(Number(event.target.value))}
                disabled={!includeComments}
              >
                <option value={1}>1</option>
                <option value={3}>3</option>
                <option value={5}>5</option>
              </select>
            </label>
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={includeComments}
              onChange={(event) => setIncludeComments(event.target.checked)}
            />
            <span>Leer comentarios principales de los mejores videos.</span>
          </label>
          <button
            type="button"
            className="primary icon-text"
            disabled={busy || !channelUrl.trim()}
            onClick={() => void analyze()}
          >
            <Icon name="globe" size={15} />
            <span>{busy ? 'Analizando…' : 'Analizar canal'}</span>
          </button>
          {progress ? (
            <div className="yt-progress">
              {(() => {
                const percent =
                  progress.total > 0
                    ? Math.min(100, Math.round((progress.current / progress.total) * 100))
                    : 5;
                return (
                  <div
                    className="yt-progress-bar"
                    role="progressbar"
                    aria-label="Progreso del análisis"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={percent}
                  >
                    <span style={{ width: `${percent}%` }} />
                  </div>
                );
              })()}
              <p className="fine-print" role="status">
                {progress.message} · {progress.current}/{progress.total}
              </p>
            </div>
          ) : null}
          {error ? (
            <p className="banner banner-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <div className="yt-results">
          {!report ? (
            <div className="card yt-empty">
              <Icon name="globe" size={26} />
              <h3>Sin análisis todavía</h3>
              <p>
                Pegá el canal y analizá. Vas a ver el mejor video, por qué rinde, cómo usa
                las miniaturas, qué títulos funcionan y qué dicen los comentarios.
              </p>
            </div>
          ) : (
            <>
              <div className="card yt-channel-head">
                <div>
                  <p className="eyebrow">Canal analizado</p>
                  <h2>{report.channelName}</h2>
                  <p className="fine-print">
                    {formatFull(report.subscribers)} suscriptores ·{' '}
                    {report.analyzedVideos} videos con detalle de {report.listedVideos} listados
                    {report.totalVideos ? ` · ${formatFull(report.totalVideos)} en total` : ''} ·
                    medido {report.fetchedAt}
                  </p>
                  <p className="fine-print">
                    El score y los insights usan solo los {report.analyzedVideos} videos con
                    detalle (los más vistos y los más nuevos de los {report.listedVideos}{' '}
                    listados). El resto no se puntúa.
                  </p>
                </div>
                <button
                  type="button"
                  className="small ghost icon-text"
                  onClick={() => openVideo(report.channelUrl)}
                >
                  <Icon name="external" size={14} />
                  <span>Abrir canal</span>
                </button>
              </div>

              {best ? (
                <article className="card yt-best">
                  {best.thumbnail ? (
                    <img src={best.thumbnail.preview} alt="" />
                  ) : (
                    <div className="yt-thumb-fallback">
                      <Icon name="film" size={22} />
                    </div>
                  )}
                  <div className="yt-best-body">
                    <p className="eyebrow">Mejor video analizado</p>
                    <h2>{best.title}</h2>
                    <p>{report.bestReasonSummary}</p>
                    <div className="yt-best-stats">
                      <span><strong>{formatCount(best.views)}</strong> vistas</span>
                      <span><strong>{formatCount(best.likes)}</strong> likes</span>
                      <span><strong>{formatCount(best.comments)}</strong> comentarios</span>
                      <span><strong>{formatPercent(best.engagementRate)}</strong> engagement</span>
                      <span><strong>{best.score.toFixed(0)}</strong>/100 score</span>
                    </div>
                    <ul className="yt-reasons">
                      {best.reasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                    <button
                      type="button"
                      className="small icon-text"
                      onClick={() => openVideo(best.url)}
                    >
                      <Icon name="external" size={14} />
                      <span>Ver en YouTube</span>
                    </button>
                  </div>
                </article>
              ) : null}

              <div className="yt-columns">
                <div className="card">
                  <p className="eyebrow">Fortalezas</p>
                  <ul className="yt-reasons">
                    {report.insights.strengths.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div className="card">
                  <p className="eyebrow">Oportunidades</p>
                  <ul className="yt-reasons">
                    {report.insights.opportunities.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="card yt-insights">
                <div className="yt-metric">
                  <span>Vistas medianas</span>
                  <strong>{formatCount(report.insights.medianViews)}</strong>
                </div>
                <div className="yt-metric">
                  <span>Engagement medio</span>
                  <strong>{formatPercent(report.insights.averageEngagement)}</strong>
                </div>
                <div className="yt-metric">
                  <span>Cadencia</span>
                  <strong>{report.insights.uploadsPerWeek.toFixed(1)}/sem</strong>
                </div>
                <div className="yt-metric">
                  <span>Mejor día</span>
                  <strong>
                    {report.insights.bestWeekday ?? '—'}
                    {report.insights.bestHourUtc !== null
                      ? ` · ${String(report.insights.bestHourUtc).padStart(2, '0')}:00 UTC`
                      : ''}
                  </strong>
                </div>
                <div className="yt-metric">
                  <span>Duración mediana</span>
                  <strong>{formatDuration(report.insights.medianDurationSeconds)}</strong>
                </div>
                <div className="yt-metric">
                  <span>Miniaturas</span>
                  <strong>
                    {report.insights.thumbnailAverage
                      ? `${report.insights.thumbnailAverage.brightness.toFixed(0)}% brillo`
                      : '—'}
                  </strong>
                </div>
              </div>

              <div className="yt-columns">
                <div className="card">
                  <p className="eyebrow">Patrones de título</p>
                  <ul className="yt-reasons">
                    <li>Números: {formatPercent(report.insights.titlePatterns.numbersPercent)}</li>
                    <li>Preguntas: {formatPercent(report.insights.titlePatterns.questionsPercent)}</li>
                    <li>Tutoriales: {formatPercent(report.insights.titlePatterns.howToPercent)}</li>
                    <li>Listas/duelos: {formatPercent(report.insights.titlePatterns.listsPercent)}</li>
                  </ul>
                  <p className="yt-keywords">
                    {report.insights.commonTitleWords.map((item) => (
                      <span key={item.keyword}>
                        {item.keyword} <small>{item.count}</small>
                      </span>
                    ))}
                  </p>
                </div>
                <div className="card">
                  <p className="eyebrow">Miniaturas del canal</p>
                  {report.insights.thumbnailAverage ? (
                    <ul className="yt-reasons">
                      <li>Brillo medio: {report.insights.thumbnailAverage.brightness.toFixed(0)}%</li>
                      <li>Saturación media: {report.insights.thumbnailAverage.saturation.toFixed(0)}%</li>
                      <li>Contraste medio: {report.insights.thumbnailAverage.contrast.toFixed(0)}%</li>
                      <li>{report.insights.thumbnailAverage.samples} miniaturas medidas</li>
                    </ul>
                  ) : (
                    <p className="fine-print">No se pudieron medir miniaturas.</p>
                  )}
                </div>
              </div>

              {report.insights.comments ? (
                <div className="card">
                  <p className="eyebrow">Comentarios del canal</p>
                  <p className="fine-print">
                    {report.insights.comments.analyzed} analizados ·{' '}
                    {formatPercent(report.insights.comments.positivePercent)} positivos ·{' '}
                    {formatPercent(report.insights.comments.negativePercent)} negativos
                  </p>
                  <p className="yt-keywords">
                    {report.insights.comments.keywords.map((item) => (
                      <span key={item.keyword}>
                        {item.keyword} <small>{item.count}</small>
                      </span>
                    ))}
                  </p>
                  {report.insights.comments.topComments.map((comment) => (
                    <blockquote
                      key={`${comment.author}-${comment.text.slice(0, 20)}-${comment.videoTitle}`}
                    >
                      <p>{comment.text}</p>
                      <footer>
                        {comment.author || 'Anónimo'} · {formatFull(comment.likes)} me gusta ·{' '}
                        {comment.videoTitle}
                      </footer>
                    </blockquote>
                  ))}
                </div>
              ) : null}

              <div className="card yt-table-card">
                <p className="eyebrow">Videos analizados</p>
                <div className="yt-table">
                  {report.videos.map((video) => (
                    <details key={video.id} className="yt-row">
                      <summary>
                        {video.thumbnail ? (
                          <img src={video.thumbnail.preview} alt="" />
                        ) : (
                          <span className="yt-thumb-fallback small">
                            <Icon name="film" size={14} />
                          </span>
                        )}
                        <span className="yt-row-title">
                          <strong>{video.title}</strong>
                          <small>
                            {formatCount(video.views)} vistas · {formatPercent(video.engagementRate)} ·{' '}
                            {video.uploadDate ?? 'sin fecha'} · {formatDuration(video.durationSeconds)}
                          </small>
                          <FlagChips flags={video.titleFlags} />
                        </span>
                        <span className="yt-row-score">{video.score.toFixed(0)}</span>
                      </summary>
                      <VideoDetails video={video} />
                      <div className="actions compact">
                        <button
                          type="button"
                          className="small icon-text"
                          onClick={() => openVideo(video.url)}
                        >
                          <Icon name="external" size={13} />
                          <span>Abrir en YouTube</span>
                        </button>
                      </div>
                    </details>
                  ))}
                </div>
              </div>

              {report.warnings.length > 0 ? (
                <div className="card yt-warnings">
                  <p className="eyebrow">Avisos</p>
                  <ul className="yt-reasons">
                    {report.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
