import type { CaptionCue, CaptionStyle } from '@editor-ia/project-schema';

/**
 * Built-in title looks. They are plain caption styles, so the same templates
 * work in the preview, the ASS renderer and the portable project file.
 */
export interface TitleTemplate {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly sample: string;
  readonly style: Omit<CaptionStyle, 'id' | 'name'>;
  readonly animation: CaptionCue['animation'];
}

export const TITLE_TEMPLATES: readonly TitleTemplate[] = [
  {
    id: 'impacto',
    name: 'Impacto',
    description: 'Grande, blanco y con contorno',
    sample: 'IMPACTO',
    style: {
      fontFamily: 'Impact',
      fontSizePx: 96,
      color: '#ffffff',
      outlineColor: '#000000',
      position: 'center',
      bold: true,
      borderStyle: 'outline',
      shadow: true,
    },
    animation: 'pop',
  },
  {
    id: '3d',
    name: '3D',
    description: 'Extrusión coral y contorno',
    sample: '3D',
    style: {
      fontFamily: 'Segoe UI',
      fontSizePx: 84,
      color: '#ffffff',
      outlineColor: '#000000',
      position: 'center',
      bold: true,
      borderStyle: 'outline',
      depth3d: 6,
      depthColor: '#f43f5e',
      shadow: false,
    },
    animation: 'pop',
  },
  {
    id: 'caja',
    name: 'Caja',
    description: 'Texto oscuro sobre placa clara',
    sample: 'Hola',
    style: {
      fontFamily: 'Segoe UI',
      fontSizePx: 60,
      color: '#101014',
      outlineColor: '#f7f7f2',
      position: 'center',
      backgroundColor: '#f7f7f2',
      bold: true,
      borderStyle: 'box',
      shadow: false,
    },
    animation: 'slide-up',
  },
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'Serif elegante abajo',
    sample: 'Una idea simple',
    style: {
      fontFamily: 'Georgia',
      fontSizePx: 52,
      color: '#f7f1e5',
      outlineColor: '#0b0e13',
      position: 'bottom',
      bold: false,
      borderStyle: 'outline',
      shadow: false,
    },
    animation: 'fade',
  },
  {
    id: 'noticias',
    name: 'Noticias',
    description: 'Placa roja para datos y alertas',
    sample: 'ÚLTIMO MOMENTO',
    style: {
      fontFamily: 'Arial',
      fontSizePx: 54,
      color: '#ffffff',
      outlineColor: '#ffffff',
      position: 'bottom',
      backgroundColor: '#c81e1e',
      bold: true,
      borderStyle: 'box',
      shadow: false,
    },
    animation: 'slide-up',
  },
  {
    id: 'cita',
    name: 'Cita',
    description: 'Serif itálica y cálida',
    sample: '“Una cita”',
    style: {
      fontFamily: 'Georgia',
      fontSizePx: 48,
      color: '#f3e5c3',
      outlineColor: '#15120e',
      position: 'center',
      italic: true,
      borderStyle: 'outline',
      shadow: false,
    },
    animation: 'fade',
  },
  {
    id: 'ticker',
    name: 'Ticker',
    description: 'Banda amarilla tipo lower third',
    sample: 'NUEVO VIDEO',
    style: {
      fontFamily: 'Trebuchet MS',
      fontSizePx: 44,
      color: '#111111',
      outlineColor: '#ffd400',
      position: 'bottom',
      backgroundColor: '#ffd400',
      bold: true,
      borderStyle: 'box',
      shadow: false,
    },
    animation: 'slide-up',
  },
];
