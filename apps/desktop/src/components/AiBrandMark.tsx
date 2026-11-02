import { useId } from 'react';
import type { ReactNode } from 'react';
import type { AiBrandId } from '../services/ai-models';

/**
 * Marcas visuales de cada proveedor de IA.
 *
 * Son dibujos propios y simplificados (color y forma de referencia de cada
 * marca), no los logotipos oficiales: sirven para identificar de un vistazo qué
 * modelo responde, sin derechos de imagen incrustados en el instalador.
 */

export interface AiBrandStyle {
  /** Color de la marca, tal como se reconoce en su identidad propia. */
  readonly color: string;
  /** Etiqueta legible de la marca. */
  readonly label: string;
  /** `true` cuando la marca es de un servicio que corre en la máquina. */
  readonly local?: boolean;
}

export const AI_BRAND_STYLES: Readonly<
  Record<AiBrandId, AiBrandStyle>
> = {
  openai: { color: '#74aa9c', label: 'OpenAI' },
  anthropic: { color: '#d97757', label: 'Claude · Anthropic' },
  google: { color: '#4285f4', label: 'Google Gemini' },
  meta: { color: '#0866ff', label: 'Llama · Meta' },
  mistral: { color: '#ff7000', label: 'Mistral AI' },
  deepseek: { color: '#4d6bfe', label: 'DeepSeek' },
  qwen: { color: '#615ced', label: 'Qwen · Alibaba' },
  xai: { color: '#d7dae2', label: 'Grok · xAI' },
  groq: { color: '#f55036', label: 'Groq' },
  moonshot: { color: '#a78bfa', label: 'Kimi · Moonshot' },
  zhipu: { color: '#2f6bff', label: 'GLM · Zhipu' },
  perplexity: { color: '#20808d', label: 'Perplexity' },
  together: { color: '#0f6fff', label: 'Together AI' },
  fireworks: { color: '#ff8a3d', label: 'Fireworks AI' },
  openrouter: { color: '#6366f1', label: 'OpenRouter' },
  ollama: { color: '#e7ebf3', label: 'Ollama', local: true },
  lmstudio: { color: '#a78bfa', label: 'LM Studio', local: true },
  vllm: { color: '#ff8a3d', label: 'vLLM', local: true },
  llamacpp: { color: '#f5a524', label: 'llama.cpp', local: true },
  azure: { color: '#3aa0f3', label: 'Azure OpenAI' },
  mock: { color: '#94a3b8', label: 'Simulado (sin red)', local: true },
  custom: { color: '#64748b', label: 'Proveedor propio' },
};

export function aiBrandLabel(brand: AiBrandId): string {
  return AI_BRAND_STYLES[brand]?.label ?? 'Proveedor';
}

function glyphs(brand: AiBrandId, gradientId: string): ReactNode {
  switch (brand) {
    case 'openai':
      // Nudo de tres elipses rotadas: se lee como la flor de OpenAI.
      return (
        <g fill="none" stroke="#eef7f2" strokeWidth="1.7">
          <ellipse cx="12" cy="12" rx="7.4" ry="4.4" />
          <ellipse cx="12" cy="12" rx="7.4" ry="4.4" transform="rotate(60 12 12)" />
          <ellipse cx="12" cy="12" rx="7.4" ry="4.4" transform="rotate(120 12 12)" />
        </g>
      );
    case 'anthropic':
      // «A» de dos trazos con barra.
      return (
        <g fill="none" stroke="#fdece4" strokeWidth="2.3" strokeLinecap="round">
          <path d="M5.6 18.4 12 5.2l6.4 13.2" />
          <path d="M8.2 14h7.6" />
        </g>
      );
    case 'google':
      // Estrella de cuatro puntas de Gemini, con degradado azul→violeta.
      return (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="1" x2="1" y2="0">
              <stop offset="0" stopColor="#4285f4" />
              <stop offset="1" stopColor="#9b72cb" />
            </linearGradient>
          </defs>
          <path
            fill={`url(#${gradientId})`}
            d="M12 2c.6 5.4 4.6 9.4 10 10-5.4.6-9.4 4.6-10 10-.6-5.4-4.6-9.4-10-10 5.4-.6 9.4-4.6 10-10Z"
          />
        </>
      );
    case 'meta':
      // Lazo continuo que se lee como la cinta de Meta.
      return (
        <path
          fill="none"
          stroke="#bcd2ff"
          strokeWidth="2.1"
          strokeLinecap="round"
          d="M2.8 12c0-3.2 1.6-5 3.6-5 2.6 0 4.4 3.4 5.6 5 1.2 1.6 3 5 5.6 5 2 0 3.6-1.8 3.6-5s-1.6-5-3.6-5c-2.6 0-4.4 3.4-5.6 5-1.2 1.6-3 5-5.6 5-2 0-3.6-1.8-3.6-5Z"
        />
      );
    case 'mistral':
      // Cinco franjas en el degradado amarillo→rojo de Mistral.
      return (
        <g>
          <rect x="4" y="4.5" width="16" height="2.6" rx="1.3" fill="#ffd800" />
          <rect x="6.6" y="8.1" width="10.8" height="2.6" rx="1.3" fill="#ffae00" />
          <rect x="4" y="11.7" width="16" height="2.6" rx="1.3" fill="#ff8200" />
          <rect x="6.6" y="15.3" width="10.8" height="2.6" rx="1.3" fill="#ff4d00" />
          <rect x="9.2" y="18.9" width="5.6" height="2.1" rx="1" fill="#ff1b00" />
        </g>
      );
    case 'deepseek':
      // Silueta de ballena simplificada.
      return (
        <g fill="#dfe6ff">
          <path d="M2.6 13.4c2.6-4.2 7.8-5.6 11.8-3.8 2.4 1.1 4.4.4 5.6-1 .4 2.6-.4 5.4-2.8 7.2-3.6 2.6-9.4 2.8-12.6.4-.9-.7-1.6-1.7-2-2.8Z" />
          <circle cx="7.2" cy="13" r="0.9" fill="#4d6bfe" />
        </g>
      );
    case 'qwen':
      return (
        <>
          <rect x="4" y="4" width="16" height="16" rx="5" fill="none" stroke="#d9d5ff" strokeWidth="1.9" />
          <circle cx="12" cy="12" r="3.1" fill="#d9d5ff" />
          <path d="M14.4 14.4 18 18" stroke="#d9d5ff" strokeWidth="1.9" strokeLinecap="round" />
        </>
      );
    case 'xai':
      return (
        <g stroke="#eef1f7" strokeWidth="2.4" strokeLinecap="round">
          <path d="M6 6 18 18" />
          <path d="M18 6 6 18" />
        </g>
      );
    case 'groq':
      return <path fill="#ffd7cd" d="M13.6 2.6 5.4 13h5l-1.6 8.4L17.8 10h-5.2Z" />;
    case 'moonshot':
      return (
        <path
          fill="#e6dbff"
          d="M15.4 2.8a9.6 9.6 0 1 0 0 18.4 7.6 7.6 0 1 1 0-18.4Z"
        />
      );
    case 'zhipu':
      return (
        <g fill="#d7e2ff">
          <rect x="4" y="5.4" width="16" height="2.8" rx="1.4" />
          <rect x="6.4" y="10.6" width="11.2" height="2.8" rx="1.4" />
          <rect x="8.8" y="15.8" width="6.4" height="2.8" rx="1.4" />
        </g>
      );
    case 'perplexity':
      return (
        <g fill="none" stroke="#cfeaf0" strokeWidth="1.8" strokeLinecap="round">
          <circle cx="12" cy="11" r="5.2" />
          <path d="M12 4.4v15.2" />
          <path d="M8.4 19.2 12 15.6l3.6 3.6" />
        </g>
      );
    case 'together':
      return (
        <g stroke="#c9ddff" strokeWidth="1.5">
          <path d="M7 7h10v10H7Z" fill="none" />
          <circle cx="7" cy="7" r="2.1" fill="#c9ddff" stroke="none" />
          <circle cx="17" cy="7" r="2.1" fill="#c9ddff" stroke="none" />
          <circle cx="7" cy="17" r="2.1" fill="#c9ddff" stroke="none" />
          <circle cx="17" cy="17" r="2.1" fill="#c9ddff" stroke="none" />
        </g>
      );
    case 'fireworks':
      return (
        <g stroke="#ffd9c0" strokeWidth="1.7" strokeLinecap="round">
          <path d="M12 4v5" />
          <path d="M12 15v5" />
          <path d="M4 12h5" />
          <path d="M15 12h5" />
          <circle cx="12" cy="12" r="2.2" fill="#ffd9c0" stroke="none" />
        </g>
      );
    case 'openrouter':
      return (
        <g stroke="#d8dbff" strokeWidth="1.6" fill="none">
          <circle cx="6" cy="12" r="2.2" />
          <circle cx="18" cy="6.6" r="2.2" />
          <circle cx="18" cy="17.4" r="2.2" />
          <path d="M8 11 16 7.2M8 13l8 3.8" />
        </g>
      );
    case 'ollama':
      // Cabeza de llama simplificada: dos orejas y el morro.
      return (
        <g fill="#f2f5fb">
          <path d="M9.1 3.4c.7 0 1.2.6 1.2 1.3v2.6H7.9V4.7c0-.7.5-1.3 1.2-1.3Z" />
          <path d="M14.9 3.4c.7 0 1.2.6 1.2 1.3v2.6h-2.4V4.7c0-.7.5-1.3 1.2-1.3Z" />
          <path d="M7.4 6.4h9.2c1.2 0 2.2 1 2.2 2.2v3.6A6.8 6.8 0 0 1 12 19a6.8 6.8 0 0 1-6.8-6.8V8.6c0-1.2 1-2.2 2.2-2.2Z" />
          <circle cx="9.6" cy="11.6" r="1" fill="#1b2333" />
          <circle cx="14.4" cy="11.6" r="1" fill="#1b2333" />
        </g>
      );
    case 'lmstudio':
      return (
        <g fill="none" stroke="#e6dbff" strokeWidth="1.8" strokeLinejoin="round">
          <path d="M12 3.2 20 8v8l-8 4.8L4 16V8Z" />
          <path d="M9 10v5M12 15h3" strokeLinecap="round" />
        </g>
      );
    case 'vllm':
      return (
        <path
          fill="#ffdcc4"
          d="M5.4 5h3l3.6 9.4L15.6 5h3L13.2 19h-2.4Z"
        />
      );
    case 'llamacpp':
      return (
        <g fill="none" stroke="#ffe2a8" strokeWidth="1.8" strokeLinejoin="round">
          <path d="M12 3.4 20 12l-8 8.6L4 12Z" />
          <circle cx="12" cy="12" r="2" fill="#ffe2a8" stroke="none" />
        </g>
      );
    case 'azure':
      return (
        <g fill="#cfe8ff">
          <path d="M13.4 3.2 6 14.6h5.2L9.6 20.8 18 9.4h-5.2Z" />
        </g>
      );
    case 'mock':
      return (
        <circle cx="12" cy="12" r="6.4" fill="none" stroke="#c3ccda" strokeWidth="1.9" strokeDasharray="3.4 3" />
      );
    default:
      return (
        <path
          fill="none"
          stroke="#b9c2cf"
          strokeWidth="1.8"
          strokeLinejoin="round"
          d="M12 4.4 19.6 12 12 19.6 4.4 12Z"
        />
      );
  }
}

/**
 * Marca de un proveedor de IA. El fondo es un tile con el color de la marca a
 * baja opacidad para que el glifo se lea sobre cualquier tema.
 */
export function AiBrandMark({
  brand,
  size = 18,
  title,
}: {
  readonly brand: AiBrandId;
  readonly size?: number;
  readonly title?: string;
}) {
  const style = AI_BRAND_STYLES[brand] ?? AI_BRAND_STYLES.custom;
  const gradientId = useId();
  return (
    <svg
      className="ai-brand-mark"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label={title ?? style.label}
    >
      <title>{title ?? style.label}</title>
      <rect
        x="0.5"
        y="0.5"
        width="23"
        height="23"
        rx="7"
        fill={style.color}
        opacity="0.16"
      />
      <rect
        x="0.75"
        y="0.75"
        width="22.5"
        height="22.5"
        rx="6.75"
        fill="none"
        stroke={style.color}
        strokeOpacity="0.45"
        strokeWidth="1"
      />
      {glyphs(brand, gradientId)}
    </svg>
  );
}
