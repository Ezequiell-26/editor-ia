import { useEffect, useState } from 'react';
import type { ViewId } from '../../app/navigation';
import { Icon } from '../../components/Icon';
import { useProjectStore } from '../../state/project-store';

const PROGRESS_KEY = 'editor-ia.learn-progress.v1';

interface LearnSection {
  readonly id: string;
  readonly title: string;
  readonly eyebrow: string;
  readonly body: string;
  readonly tips?: readonly string[];
  readonly action?: { readonly label: string; readonly view: ViewId };
}

const QUICK_STEPS: readonly { readonly title: string; readonly body: string; readonly view: ViewId; readonly label: string }[] = [
  {
    title: 'Creá el proyecto',
    body: 'Elegí formato y fps exactos. Podés cambiarlos después sin perder los segundos.',
    view: 'projects',
    label: 'Ir a Proyectos',
  },
  {
    title: 'Escribí las escenas',
    body: 'Generá un guion con IA o escribilo a mano. Cada escena puede tener su prompt visual.',
    view: 'script',
    label: 'Abrir Guion',
  },
  {
    title: 'Importá los recursos',
    body: 'Imágenes, videos y voces. Confirmá derechos y licencia antes de montar.',
    view: 'assets',
    label: 'Abrir Medios',
  },
  {
    title: 'Montá automático',
    body: 'Producción genera la voz, asigna imágenes, crea subtítulos y alterna Ken Burns.',
    view: 'production',
    label: 'Abrir Producción',
  },
  {
    title: 'Revisá y exportá',
    body: 'Ajustá en el editor, elegí compresión y exportá un MP4 verificado o un lote.',
    view: 'editor',
    label: 'Abrir Editor',
  },
];

const SECTIONS: readonly LearnSection[] = [
  {
    id: 'project',
    eyebrow: '01 · Proyecto',
    title: 'Cualquier formato y fps',
    body: 'En Proyectos elegí 16:9, 9:16, 1:1, 4:5, 4:3, 21:9 o Personalizado. La tasa admite presets de cine/NTSC y cualquier par numerador/denominador. Dentro del editor, el Inspector reajusta toda la timeline si cambiás los fps.',
    tips: [
      'H.264 necesita dimensiones pares; la app las redondea solas.',
      'Si un clip tiene velocidad distinta de 1×, volvelo a 1× antes de cambiar fps.',
    ],
    action: { label: 'Crear o abrir proyecto', view: 'projects' },
  },
  {
    id: 'assets',
    eyebrow: '02 · Medios',
    title: 'Importar sin perder originales',
    body: 'Cada archivo se copia a media/, se mide con FFprobe, se hashea con SHA-256 y queda con licencia y procedencia. Un material sin derechos confirmados no se puede montar ni exportar.',
    tips: [
      'Arrastrá varios archivos o importá una carpeta completa desde Medios.',
      'Los medios se pueden buscar y filtrar por tipo.',
    ],
    action: { label: 'Abrir Medios', view: 'assets' },
  },
  {
    id: 'script',
    eyebrow: '03 · Guion',
    title: 'Escenas, narración y prompts',
    body: 'El generador crea hasta 30 escenas con intención, narración y nota visual. Podés editarlas, agregar escenas a mano y descargar un .txt con un prompt por escena para Flow.',
    tips: [
      'El proveedor simulado funciona sin red y sin clave.',
      'Los prompts de Flow se guardan con el estilo que elijas.',
    ],
    action: { label: 'Abrir Guion', view: 'script' },
  },
  {
    id: 'voice',
    eyebrow: '04 · Voz',
    title: 'SAPI gratis, ElevenLabs o web',
    body: 'Producción sintetiza la narración con las voces instaladas de Windows, sin red. Si configurás ElevenLabs, la app pide confirmar créditos antes de llamar. La web externa es un puente manual: abre la página y vos importás el audio.',
    tips: ['La Fábrica fuerza SAPI local para no consumir créditos en un lote.'],
    action: { label: 'Configurar voz', view: 'settings' },
  },
  {
    id: 'automatic',
    eyebrow: '05 · Automático',
    title: 'Producción monta por vos',
    body: 'Asigna imágenes por orden o por similitud de prompt, usa la duración exacta de cada voz, crea subtítulos, aplica Ken Burns y transiciones y deja todo editable en la timeline. También genera el video desde cero si faltan voces.',
    tips: [
      'Sin audio, elige cuántos segundos dura cada imagen.',
      'El montaje automático no finge alinear palabras con imágenes.',
    ],
    action: { label: 'Abrir Producción', view: 'production' },
  },
  {
    id: 'director',
    eyebrow: '06 · Director',
    title: 'Cortes inteligentes y medidos',
    body: 'Analiza silencios, escenas, negros, freezes, ruido y loudness con FFmpeg. Detecta tomas repetidas por texto, quita muletillas no léxicas, limpia la voz, normaliza a -14 LUFS y arma subtítulos. Todo queda como clips normales y se puede deshacer.',
    tips: ['La memoria local aprende de los cambios que conservás; no es una red neuronal.'],
    action: { label: 'Abrir Director', view: 'director' },
  },
  {
    id: 'editor',
    eyebrow: '07 · Editor',
    title: 'Edición manual completa',
    body: 'Timeline por frames con varias pistas: mover, recortar, dividir, velocidad 0,1×–4×, efectos de color, fades, Ken Burns, chroma key, audio con EQ/compresor/denoise, subtítulos por palabra y ducking de música.',
    tips: [
      'S divide el clip en el cabezal; Ctrl+D duplica.',
      'Las guías de composición se activan arriba de la preview.',
    ],
    action: { label: 'Abrir Editor', view: 'editor' },
  },
  {
    id: 'factory',
    eyebrow: '08 · Fábrica',
    title: 'N variantes desde un brief',
    body: 'Generá entre 1 y 10 variantes con guion propio, voz local, imágenes compartidas, movimiento, transiciones y subtítulos. Cada variante es un proyecto portable; opcionalmente se renderiza un MP4 por variante.',
    tips: ['Cada corrida agrega un sufijo único y nunca sobrescribe otra variante.'],
    action: { label: 'Abrir Fábrica', view: 'factory' },
  },
  {
    id: 'export',
    eyebrow: '09 · Export',
    title: 'Archivos chicos y verificados',
    body: 'El perfil “Formato del proyecto” exporta exactamente tu canvas. Elegí Rápido, Equilibrado, Compacto o Máxima calidad. El modo Compacto usa CRF 27 y audio de 96 kbps; H.265 reduce más el tamaño, pero H.264 es más compatible. El MP4 sólo se marca completado después de FFprobe.',
    tips: [
      'El lote elige una carpeta y renderiza todos los perfiles en secuencia.',
      '“Compacto” tarda un poco más porque usa un preset de mayor compresión.',
    ],
    action: { label: 'Exportar desde el editor', view: 'editor' },
  },
  {
    id: 'convert',
    eyebrow: '10 · Convertir',
    title: 'Imagen, video y audio',
    body: 'Convertí assets listos a PNG, JPEG, WebP, MP4, WebM, MOV, GIF, MP3 o WAV, con calidad y ancho máximo. La salida se verifica con FFprobe y nunca sobrescribe el original.',
    action: { label: 'Abrir Convertir', view: 'convert' },
  },
  {
    id: 'mcp',
    eyebrow: '11 · MCP',
    title: 'Conectá herramientas locales',
    body: 'Agregá un servidor MCP por stdio con comando y argumentos. Editor IA guarda los nombres de las variables y sus valores en el Administrador de credenciales de Windows. Probá el handshake, mirá las herramientas y ejecutalas con JSON.',
    tips: ['Nada se ejecuta al guardar; sólo al pulsar Probar o Ejecutar.'],
    action: { label: 'Abrir MCP', view: 'mcp' },
  },
  {
    id: 'shortcuts',
    eyebrow: '12 · Ayuda',
    title: 'Atajos y límites',
    body: 'Ctrl+O abre, Ctrl+S guarda, Ctrl+E exporta, Ctrl+D duplica, S divide, Espacio reproduce y F11 va a pantalla completa. La app no publica en redes, no descarga stock sin procedencia y no entrena modelos con tus datos.',
    tips: [
      'La preview es aproximada; el archivo que manda es el MP4 renderizado.',
      'FFmpeg, FFprobe y PowerShell SAPI son requisitos externos.',
    ],
  },
];

function loadDone(): Set<string> {
  try {
    const raw = window.localStorage.getItem(PROGRESS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []);
  } catch {
    return new Set();
  }
}

export function LearnView({ onNavigate }: { readonly onNavigate: (id: ViewId) => void }) {
  const store = useProjectStore();
  const [done, setDone] = useState<Set<string>>(loadDone);
  const [query, setQuery] = useState('');
  const project = store.state.project;

  useEffect(() => {
    try {
      window.localStorage.setItem(PROGRESS_KEY, JSON.stringify([...done]));
    } catch {
      // Progress is a convenience; the guide still works without storage.
    }
  }, [done]);

  const visible = SECTIONS.filter((section) => {
    if (!query.trim()) return true;
    const haystack = `${section.title} ${section.body} ${section.tips?.join(' ') ?? ''}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  });
  const completed = SECTIONS.filter((section) => done.has(section.id)).length;
  const percent = Math.round((completed / SECTIONS.length) * 100);

  function toggle(id: string, checked: boolean): void {
    setDone((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  return (
    <section className="view learn-view">
      <div className="view-head learn-head">
        <div>
          <p className="eyebrow">Centro de aprendizaje</p>
          <h2>Tu primer video, paso a paso</h2>
          <p className="view-summary">
            Todo lo necesario para crear, editar y exportar sin adivinar. Cada tarjeta abre la
            herramienta que explica. El progreso se guarda sólo en este equipo.
          </p>
        </div>
        <div className="learn-progress" aria-label={`Progreso ${percent}%`}>
          <div
            className="learn-progress-ring"
            style={{
              background: `conic-gradient(var(--color-accent) ${percent}%, var(--color-panel-3) 0)`,
            }}
          >
            <strong>{percent}%</strong>
            <span>aprendido</span>
          </div>
          <span className="fine-print">
            {completed} de {SECTIONS.length} temas
          </span>
        </div>
      </div>

      {!project ? (
        <p className="notice notice-warning">
          Todavía no hay un proyecto abierto. Podés leer la guía igual o crear uno para practicar
          mientras avanzás.
        </p>
      ) : null}

      <article className="learn-quick">
        <div className="learn-quick-head">
          <div>
            <p className="eyebrow">Ruta rápida</p>
            <h3>De la idea al MP4 en cinco pasos</h3>
          </div>
          <button type="button" className="primary" onClick={() => onNavigate('projects')}>
            Empezar ahora
          </button>
        </div>
        <ol className="learn-steps">
          {QUICK_STEPS.map((step, index) => (
            <li key={step.title}>
              <span className="learn-step-number">{String(index + 1).padStart(2, '0')}</span>
              <div>
                <strong>{step.title}</strong>
                <p>{step.body}</p>
                <button type="button" className="link-button" onClick={() => onNavigate(step.view)}>
                  {step.label} →
                </button>
              </div>
            </li>
          ))}
        </ol>
      </article>

      <div className="learn-toolbar">
        <label className="field learn-search">
          <span>Buscar en la guía</span>
          <input
            type="search"
            value={query}
            placeholder="exportar, subtítulos, fps, voz, MCP…"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="ghost icon-text"
          onClick={() =>
            void store.service
              .openExternalUrl('https://github.com/Ezequiell-26/editor-ia/blob/main/docs/TUTORIAL.md')
              .catch(() => store.setNotice('No se pudo abrir el tutorial en GitHub.'))
          }
        >
          <Icon name="external" size={15} />
          <span>Abrir tutorial completo</span>
        </button>
      </div>

      <div className="learn-grid">
        {visible.map((section) => (
          <article
            key={section.id}
            className={`learn-card${done.has(section.id) ? ' done' : ''}`}
          >
            <div className="learn-card-head">
              <div>
                <p className="eyebrow">{section.eyebrow}</p>
                <h3>{section.title}</h3>
              </div>
              <label className="learn-check">
                <input
                  type="checkbox"
                  checked={done.has(section.id)}
                  onChange={(event) => toggle(section.id, event.target.checked)}
                />
                <span>Hecho</span>
              </label>
            </div>
            <p>{section.body}</p>
            {section.tips?.length ? (
              <ul className="learn-tips">
                {section.tips.map((tip) => (
                  <li key={tip}>{tip}</li>
                ))}
              </ul>
            ) : null}
            {section.action ? (
              <button
                type="button"
                className="small accent-outline"
                onClick={() => onNavigate(section.action!.view)}
              >
                {section.action.label}
              </button>
            ) : null}
          </article>
        ))}
        {visible.length === 0 ? (
          <p className="empty-inline">No hay temas que coincidan con “{query}”.</p>
        ) : null}
      </div>
    </section>
  );
}
