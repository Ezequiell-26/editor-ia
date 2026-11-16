import type { IconName } from '../../../components/Icon';

/**
 * Modelo de la réplica AlaukCut. Todo el contenido es estático y medido de las
 * 15 capturas de referencia (1360x768) adjuntadas el 13/11/2026. Las texturas
 * viven en `public/alaukcut/` y son recortes de esas mismas capturas: son los
 * «medios» del proyecto de demostración, no maquetas de UI.
 */

export type Scene = 'empty' | 'media' | 'captions' | 'studio';

export type InspectorTab =
  | 'detalhes'
  | 'assistant'
  | 'video'
  | 'color-scopes'
  | 'color-basic'
  | 'color-wheels'
  | 'color-hsl'
  | 'color-hsl2';

export const COLOR_TABS: readonly InspectorTab[] = [
  'color-scopes', 'color-basic', 'color-wheels', 'color-hsl', 'color-hsl2',
];

export const PRODUCT = 'AlaukCut';

export const asset = (name: string): string => `./alaukcut/${name}`;

export function pad(value: number): string {
  return String(Math.floor(value)).padStart(2, '0');
}

export function clock(frame: number, fps: number): string {
  const whole = Math.max(0, Math.floor(frame));
  const hours = Math.floor(whole / (fps * 3600));
  const minutes = Math.floor((whole % (fps * 3600)) / (fps * 60));
  const seconds = Math.floor((whole % (fps * 60)) / fps);
  const frames = Math.floor(whole % fps);
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}:${pad(frames)}`;
}

/* ── Barra de categorías (idéntica en las 15 capturas) ─────────────────── */

export const TABS: readonly { readonly id: string; readonly label: string; readonly icon: IconName }[] = [
  { id: 'midia', label: 'Mídia', icon: 'film' },
  { id: 'audio', label: 'Áudio', icon: 'audio' },
  { id: 'texto', label: 'Texto', icon: 'text' },
  { id: 'elementos', label: 'Elementos', icon: 'star' },
  { id: 'efeitos', label: 'Efeitos', icon: 'effects' },
  { id: 'transicoes', label: 'Transições', icon: 'layers' },
  { id: 'legendas', label: 'Legendas', icon: 'captions' },
  { id: 'filtros', label: 'Filtros', icon: 'filters' },
  { id: 'templates', label: 'Templates', icon: 'grid' },
  { id: 'hyperframes', label: 'Hyperframes', icon: 'sparkles' },
];

/* ── Estado vacío · panel «Detalhes» (capturas 146/147) ────────────────── */

export const FEATURE_CARDS: readonly {
  readonly icon: IconName;
  readonly title: string;
  readonly text: string;
}[] = [
  { icon: 'captions', title: 'Legendas automáticas', text: 'A fala vira legenda com o tempo de cada palavra, em 15 estilos.' },
  { icon: 'pencil', title: 'Desenho com mãozinha', text: 'A mãozinha escreve o texto sobre o quadro branco, letra por letra.' },
  { icon: 'palette', title: 'Cor de cinema', text: '16 tratamentos medidos de cena real, com intensidade regulável.' },
  { icon: 'layers', title: 'Transições e efeitos', text: '48 transições e 15 efeitos que rodam na placa, sem espera.' },
];

/* ── Biblioteca de medios (capturas 149/151) ────────────────────────────── */

export interface MediaItem {
  readonly id: string;
  readonly label: string;
  readonly thumb: string;
  readonly duration?: string;
  readonly monitor?: string;
}

export const MEDIA_ITEMS: readonly MediaItem[] = [
  { id: 'audio', label: 'audio para testes.mp3', thumb: asset('thumb-00.png'), duration: '02:57' },
  { id: 'ceu', label: 'cEU LINDO.png', thumb: asset('thumb-01.png') },
  { id: 'chat1', label: 'ChatGPT Image 16_09_...', thumb: asset('thumb-02.png') },
  { id: 'chat2', label: 'ChatGPT Image 16_09_...', thumb: asset('thumb-03.png') },
  { id: 'doodly', label: 'Img estilo Doodly Moç...', thumb: asset('thumb-10.png'), monitor: asset('media-scribe.png') },
  { id: 'menino', label: 'MENINO FUNDO VERD...', thumb: asset('thumb-11.png'), monitor: asset('media-green-boy.png') },
  { id: 'para', label: 'Para AlaukCut.png', thumb: asset('thumb-12.png'), monitor: asset('media-hand.png') },
];

export const STUDIO_ITEMS: readonly MediaItem[] = [
  { id: 'foto', label: '20260918_065251(0).jpg', thumb: asset('studio-thumb-0.png') },
  { id: 'video', label: 'lv_0_20261023141630.m...', thumb: asset('studio-thumb-1.png'), duration: '00:14', monitor: asset('media-vertical.png') },
];

/* ── Estilos de leyendas (captura 153) ─────────────────────────────────── */

export interface SubtitleStyle {
  readonly sample: string;
  readonly name: string;
  readonly variant: string;
}

export const SUBTITLE_STYLES: readonly SubtitleStyle[] = [
  { sample: 'que comprou esse\nhomem ao caminho', name: 'Personalizada', variant: '(palavra...' },
  { sample: 'foi nesse momento\nque ela chegou', name: 'Padrão', variant: '(branca)' },
  { sample: 'TODOS QUEREM\nSABER A VERDADE', name: 'Cinemática', variant: '(eco)' },
  { sample: 'SLOWED REVERB', name: 'Neon', variant: '(cinética)' },
  { sample: 'R$5,81...', name: 'Metal', variant: '(incandescente)' },
  { sample: 'IRIS RYT... BIT...', name: 'Eco', variant: '(chave dourada)' },
  { sample: 'SOUNDS...', name: 'Foco', variant: '(varre e apaga)' },
  { sample: 'o vento estava\nsoprando forte', name: 'Amarela', variant: '(Verdana)' },
  { sample: 'AGORA', name: 'Explosão', variant: '(modo + po...' },
  { sample: 'SUR MARCH', name: 'Cromo', variant: '(futurista)' },
  { sample: 'UMA PARTE\nSIGNIFICATIVA', name: 'Jumper', variant: '(rosa rosa)' },
  { sample: 'UMA PARTE\nSIGNIFICATIVA', name: 'Jumper', variant: '(azul azul)' },
  { sample: 'TUDO', name: 'Fixo', variant: '(palavra branca)' },
  { sample: 'TUDO COMEÇA', name: 'Dupla', variant: '(faixa amarela)' },
  { sample: 'TUDO', name: 'Gibi', variant: '(cores vivas)' },
  { sample: 'tudo começa\nagora', name: 'Teja', variant: '(amarela, sobrinha)' },
];

/* ── Asistente (captura 152) ───────────────────────────────────────────── */

export const ASSISTANT_MODELS: readonly {
  readonly label: string;
  readonly status: string;
  readonly tone: 'green' | 'amber' | 'grey';
}[] = [
  { label: 'Claude Code (aqui dentro)', status: 'usa seu plano', tone: 'green' },
  { label: 'Codex (aqui dentro)', status: 'usa seu plano', tone: 'green' },
  { label: 'Aqui dentro (API)', status: 'pago à Anthropic', tone: 'amber' },
  { label: 'Claude — o aplicativo de conversar (funciona até no plano grátis)', status: 'grátis', tone: 'green' },
  { label: 'Claude Code — no terminal, para hyperframes (exige plano pago)', status: 'grátis', tone: 'green' },
  { label: 'Codex — o da OpenAI, no terminal ou no aplicativo', status: 'grátis', tone: 'green' },
  { label: 'Antigravity, do Google (aplicativo, editor ou terminal)', status: 'encontrado', tone: 'amber' },
  { label: 'OpenCode, o assistente de código aberto (terminal ou aplicativo)', status: 'encontrado', tone: 'amber' },
  { label: 'Grok Build, o da xAI, no terminal (exige SuperGrok ou X Premium+)', status: 'não encontrei', tone: 'grey' },
];

/* ── HSL por cor (capturas 159/160) ────────────────────────────────────── */

export const HSL_COLUMNS: readonly { readonly label: string; readonly hue: number; readonly gradient: string }[] = [
  { label: 'Vermelho', hue: 0, gradient: 'linear-gradient(90deg,#ff004c,#ff7a00)' },
  { label: 'Pele', hue: -44, gradient: 'linear-gradient(90deg,#f04a2a,#ffc93c)' },
  { label: 'Amarelo', hue: 0, gradient: 'linear-gradient(90deg,#e8a400,#9ede00)' },
  { label: 'Verde', hue: 66, gradient: 'linear-gradient(90deg,#d4e800,#00d98a)' },
  { label: 'Ciano', hue: 0, gradient: 'linear-gradient(90deg,#00e28a,#0090ff)' },
  { label: 'Azul', hue: 88, gradient: 'linear-gradient(90deg,#00d0ff,#7a4bff)' },
  { label: 'Magenta', hue: 0, gradient: 'linear-gradient(90deg,#ff3ad0,#ff2a4f)' },
];

/* ── Timeline ─────────────────────────────────────────────────────────── */

export const TIMELINE_TOOLS_LEFT: readonly { readonly icon: IconName; readonly label: string }[] = [
  { icon: 'plus', label: 'Nova faixa' },
  { icon: 'play', label: 'Reproduzir' },
  { icon: 'magnet', label: 'Imã' },
  { icon: 'undo', label: 'Desfazer' },
  { icon: 'redo', label: 'Refazer' },
  { icon: 'split', label: 'Dividir' },
  { icon: 'trash', label: 'Excluir' },
  { icon: 'copy', label: 'Copiar' },
  { icon: 'marker', label: 'Marcador' },
  { icon: 'hand', label: 'Mover' },
];

export const TIMELINE_TOOLS_RIGHT: readonly { readonly icon: IconName; readonly label: string }[] = [
  { icon: 'magnet', label: 'Imã' },
  { icon: 'fit', label: 'Encaixar' },
  { icon: 'text', label: 'Texto' },
  { icon: 'marker', label: 'Marcador' },
  { icon: 'settings', label: 'Ajustes' },
  { icon: 'scan', label: 'Rastreamento' },
];

export const RULER_EMPTY: readonly string[] = [
  '00:00', '00:30', '01:00', '01:30', '02:00', '02:30', '03:00', '03:30',
  '04:00', '04:30', '05:00', '05:30', '06:00', '06:30', '07:00', '07:30',
  '08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00',
];

export const RULER_STUDIO: readonly string[] = [
  '01:00', '01:05', '01:10', '01:15', '01:20',
];
