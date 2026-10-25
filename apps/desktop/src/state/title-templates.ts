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
  {
    // Lower Third de DaVinci: placa con borde de acento para nombre y cargo.
    id: 'lower-third',
    name: 'Lower Third',
    description: 'Placa profesional con borde de acento',
    sample: 'Nombre\nCargo o rol',
    style: {
      fontFamily: 'Segoe UI',
      fontSizePx: 50,
      color: '#ffffff',
      outlineColor: '#0b0e13',
      position: 'bottom',
      backgroundColor: '#101418',
      bold: true,
      borderStyle: 'box',
      shadow: true,
    },
    animation: 'slide-up',
  },
  {
    // Text+ de DaVinci: neón con profundidad, para intros y avisos.
    id: 'text-plus',
    name: 'Text+',
    description: 'Neón con extrusión para intros',
    sample: 'TEXT+',
    style: {
      fontFamily: 'Segoe UI',
      fontSizePx: 88,
      color: '#e0f2fe',
      outlineColor: '#0ea5e9',
      position: 'center',
      bold: true,
      borderStyle: 'outline',
      depth3d: 8,
      depthColor: '#6366f1',
      shadow: true,
    },
    animation: 'pop',
  },
  {
    // Scroll de DaVinci: créditos que suben, serif y sobrio.
    id: 'scroll',
    name: 'Scroll',
    description: 'Créditos que suben, serif sobrio',
    sample: 'Guion y dirección\nOlyvia',
    style: {
      fontFamily: 'Georgia',
      fontSizePx: 46,
      color: '#f5f5f4',
      outlineColor: '#0b0e13',
      position: 'center',
      italic: false,
      borderStyle: 'outline',
      shadow: true,
    },
    animation: 'fade',
  },
  {
    // Retícula de informativos: barra inferior con titular y subtítulo.
    // El estilo es único por pista, así que ambas líneas comparten tamaño.
    id: 'reticula-noticias',
    name: 'Retícula noticias',
    description: 'Barra inferior con titular y subtítulo',
    sample: 'TITULAR PRINCIPAL\nSubtítulo de la noticia',
    style: {
      fontFamily: 'Arial',
      fontSizePx: 44,
      color: '#ffffff',
      outlineColor: '#0f1e3d',
      position: 'bottom',
      backgroundColor: '#0f1e3d',
      bold: true,
      borderStyle: 'box',
      shadow: false,
    },
    animation: 'slide-up',
  },
  {
    // Kicker de cabecera: etiqueta de acento para acompañar un título.
    // El esquema solo posiciona arriba/centro/abajo (sin eje horizontal ni
    // rotación en estilos), así que la etiqueta vive en la franja superior.
    id: 'kicker-lateral',
    name: 'Kicker lateral',
    description: 'Etiqueta de acento en la cabecera',
    sample: 'EN VIVO\nTítulo principal',
    style: {
      fontFamily: 'Arial',
      fontSizePx: 32,
      color: '#ffffff',
      outlineColor: '#0369a1',
      position: 'top',
      backgroundColor: '#0369a1',
      bold: true,
      borderStyle: 'box',
      shadow: false,
    },
    animation: 'slide-up',
  },
  {
    // Cita de documental: serif itálica centrada con línea de atribución.
    id: 'cita-documental',
    name: 'Cita documental',
    description: 'Serif centrada con atribución',
    sample: '“El archivo no miente.”\n— Testimonio, 1998',
    style: {
      fontFamily: 'Georgia',
      fontSizePx: 44,
      color: '#f5f0e6',
      outlineColor: '#14110c',
      position: 'center',
      bold: false,
      italic: true,
      borderStyle: 'outline',
      shadow: true,
    },
    animation: 'fade',
  },
  {
    // Marca de agua: el esquema no tiene opacidad por estilo ni color con
    // alfa, así que la discreción se logra con color apagado y sin sombra.
    id: 'marca-agua',
    name: 'Marca de agua',
    description: 'Firma discreta en gris apagado',
    sample: '@tucanal',
    style: {
      fontFamily: 'Segoe UI',
      fontSizePx: 26,
      color: '#9aa3ad',
      outlineColor: '#1a1e24',
      position: 'bottom',
      bold: false,
      borderStyle: 'outline',
      shadow: false,
    },
    animation: 'fade',
  },
  {
    // Capítulo numerado: gran tamaño y entrada por opacidad ('fade' es la
    // única entrada por opacidad que admite la animación de plantilla).
    id: 'capitulo',
    name: 'Capítulo',
    description: 'Numerado, grande y con fundido',
    sample: 'CAPÍTULO 01\nEl comienzo',
    style: {
      fontFamily: 'Georgia',
      fontSizePx: 100,
      color: '#f7f1e5',
      outlineColor: '#0b0e13',
      position: 'center',
      bold: true,
      borderStyle: 'outline',
      shadow: true,
    },
    animation: 'fade',
  },
  {
    // Entrevista: placa clara con nombre y cargo en el tercio inferior.
    id: 'entrevista',
    name: 'Entrevista',
    description: 'Nombre y cargo en placa clara',
    sample: 'Nombre Apellido\nCargo · Medio',
    style: {
      fontFamily: 'Segoe UI',
      fontSizePx: 42,
      color: '#111111',
      outlineColor: '#f5f5f4',
      position: 'bottom',
      backgroundColor: '#f5f5f4',
      bold: true,
      borderStyle: 'box',
      shadow: false,
    },
    animation: 'slide-up',
  },
];
