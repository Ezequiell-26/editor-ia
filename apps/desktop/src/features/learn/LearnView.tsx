import { useEffect, useState } from 'react';
import type { ViewId } from '../../app/navigation';
import { NAV_VIEWS } from '../../app/navigation';
import { Icon } from '../../components/Icon';
import { PandaGuide } from '../../components/PandaGuide';
import { useProjectStore } from '../../state/project-store';
import {
  LEARNING_UPDATED_EVENT,
  loadLearningState,
  setSectionCompleted,
  type LearningState,
} from '../../state/learning-progress';

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
    body: 'Producción genera la voz, asigna imágenes o videos, crea subtítulos y alterna Ken Burns.',
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
    body: 'Asigna imágenes o videos por orden o por similitud de prompt, usa la duración exacta de cada voz, crea subtítulos, aplica Ken Burns y disolvencias y deja todo editable en la timeline. Un video más corto se estira hasta 2× o se respalda con una imagen. También genera el video desde cero si faltan voces.',
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
    tips: ['La app registra las herramientas que usás para ordenar esta guía.'],
    action: { label: 'Abrir Director', view: 'director' },
  },
  {
    id: 'editor',
    eyebrow: '07 · Editor',
    title: 'Edición manual completa',
    body: 'Medios a la izquierda, Inspector al centro con pestañas Video/Audio/Velocidad/Animación/Color/Estilo/Todo, preview a la derecha y timeline abajo. Timeline por frames con varias pistas: mover, recortar, dividir, copiar/pegar y ripple, velocidad y rampa de 3 tramos, reverse, freeze frame, proxies de preview, máscaras rectangulares/elípticas con rotación y keyframes, 9 modos de mezcla, igualar color, efectos de color con ruedas sombras/medios/luces, HSL selectivo, LUT .cube con intensidad, scopes de onda/vectorscopio/histograma, fades, keyframes de escala/posición/rotación/opacidad/volumen con curvas, disolvencias, animaciones de entrada/salida por clip (fundido y deslizamiento), biblioteca de títulos con plantillas, estilos y animaciones, Ken Burns, chroma key, audio con EQ/compresor/denoise/efectos de voz, subtítulos por palabra, importación/exportación SRT/VTT y ducking de música.',
    tips: [
      'S divide el clip en el cabezal; Ctrl+D duplica y clic derecho abre más acciones.',
      'H activa la mano para mover la timeline; Ctrl+rueda acerca y Shift+rueda desplaza.',
      'El Look del proyecto (Proyecto → Look del proyecto) aplica color y LUT global sin tocar los clips.',
      'Las guías y los scopes se activan arriba de la preview; los scopes muestrean el clip visual activo.',
      'Los capítulos avisan si no cumplen el mínimo de YouTube: tres cortes y 10 s entre inicios.',
    ],
    action: { label: 'Abrir Editor', view: 'editor' },
  },
  {
    id: 'factory',
    eyebrow: '08 · Fábrica',
    title: 'N variantes desde un brief',
    body: 'En Fábrica, el Autopiloto encadena guion, voz, generación opcional de un medio por escena con Flow, montaje, proyecto portable y MP4 verificado. La cola sobrevive al reinicio, exige autorizar créditos y permite reanudar sólo el render. La fábrica clásica genera 1–10 variantes con medios compartidos.',
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
    id: 'download',
    eyebrow: '10 · Descargar',
    title: 'Videos y fotos de la web',
    body: 'La vista Descargar usa yt-dlp para bajar videos, audio, fotos y carruseles públicos hasta 8K. Acepta enlaces completos, dominios sin https y texto compartido. Analiza el enlace, muestra las calidades reales y permite recomprimir con FFmpeg (H.265/H.264). Toda descarga queda en Descargas/Videos descargados/<Plataforma>/<Nombre del video>; con proyecto abierto además se importa a Medios. Podés elegir Mejor, Mínima o una altura concreta.',
    tips: [
      'Confirmá derechos antes de descargar; no se evade DRM, login, captcha ni contenido privado.',
      'La compresión es local y sólo conserva el archivo nuevo si queda más chico.',
      'Los carruseles se limitan a 12 elementos; pegá la URL de un post individual.',
    ],
    action: { label: 'Abrir Descargar', view: 'download' },
  },
  {
    id: 'convert',
    eyebrow: '11 · Convertir',
    title: 'Imagen, video y audio',
    body: 'Convertí assets listos a PNG, JPEG, WebP, MP4, WebM, MOV, GIF, MP3 o WAV, con calidad y ancho máximo. La salida se verifica con FFprobe y nunca sobrescribe el original.',
    action: { label: 'Abrir Convertir', view: 'convert' },
  },
  {
    id: 'mcp',
    eyebrow: '12 · MCP',
    title: 'Conectá herramientas locales',
    body: 'Agregá un servidor MCP por stdio con comando y argumentos. Olyvia guarda los nombres de las variables y sus valores en el Administrador de credenciales de Windows. Probá el handshake, mirá las herramientas y ejecutalas con JSON.',
    tips: ['Nada se ejecuta al guardar; sólo al pulsar Probar o Ejecutar.'],
    action: { label: 'Abrir MCP', view: 'mcp' },
  },
  {
    id: 'shortcuts',
    eyebrow: '13 · Ayuda',
    title: 'Atajos y límites',
    body: 'Ctrl+O abre, Ctrl+S guarda, Ctrl+E exporta, Ctrl+D duplica, S divide, Espacio reproduce y F11 va a pantalla completa. La app no publica en redes, no descarga stock sin procedencia y no entrena modelos con tus datos.',
    tips: [
      'La preview es aproximada; el archivo que manda es el MP4 renderizado.',
      'FFmpeg, FFprobe y PowerShell SAPI son requisitos externos.',
    ],
  },
];

export function LearnView({ onNavigate }: { readonly onNavigate: (id: ViewId) => void }) {
  const store = useProjectStore();
  const [learning, setLearning] = useState<LearningState>(loadLearningState);
  const [query, setQuery] = useState('');
  const project = store.state.project;

  useEffect(() => {
    const sync = (): void => setLearning(loadLearningState());
    window.addEventListener(LEARNING_UPDATED_EVENT, sync);
    return () => window.removeEventListener(LEARNING_UPDATED_EVENT, sync);
  }, []);

  const done = new Set(learning.completed);
  const visible = SECTIONS.filter((section) => {
    if (!query.trim()) return true;
    const haystack = `${section.title} ${section.body} ${section.tips?.join(' ') ?? ''}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  });
  const completed = SECTIONS.filter((section) => done.has(section.id)).length;
  const percent = Math.round((completed / SECTIONS.length) * 100);
  const lastView = learning.lastView
    ? NAV_VIEWS.find((view) => view.id === learning.lastView)
    : null;
  const nextSection = SECTIONS.find((section) => !done.has(section.id));
  const pandaMessage = lastView ? `Ya viste ${lastView.label}.` : 'Hola, soy Pando.';
  const pandaDetail = nextSection
    ? `Seguimos con ${nextSection.title}.`
    : 'Ya recorriste todos los temas.';

  function toggle(id: string, checked: boolean): void {
    setLearning(setSectionCompleted(id, checked));
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
            className="learn-progress-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <span style={{ width: `${percent}%` }} />
          </div>
          <span className="fine-print">
            {percent}% · {completed} de {SECTIONS.length} temas
          </span>
        </div>
      </div>

      <div className="learn-guide">
        <PandaGuide message={pandaMessage} detail={pandaDetail} compact />
        {nextSection?.action ? (
          <button
            type="button"
            className="icon-button"
            aria-label={`Continuar con ${nextSection.title}`}
            title={`Continuar con ${nextSection.title}`}
            onClick={() => onNavigate(nextSection.action!.view)}
          >
            <Icon name="play" size={16} />
          </button>
        ) : null}
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
