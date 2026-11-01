/**
 * Catálogo generado por scripts/generate-motion-catalog.mjs — no editar a mano.
 *
 * Assets: react-useanimations (https://github.com/useAnimations/react-useanimations),
 * licencia MIT. Cada entrada fija SHA-256 y tamaño para verificar la descarga
 * antes de escribirla en la caché local.
 */
export type MotionLibraryCategory =
  | 'estado'
  | 'comunicación'
  | 'media'
  | 'datos'
  | 'tiempo'
  | 'sistema'
  | 'general'
  | 'marcas';

export interface MotionLibraryItem {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly category: MotionLibraryCategory;
  readonly tags: readonly string[];
  readonly license: 'MIT';
  readonly author: 'useAnimations';
  readonly source: string;
  readonly fileUrl: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly bundled: boolean;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly durationSeconds: number;
}

export const MOTION_LIBRARY_SOURCE = 'https://raw.githubusercontent.com/useAnimations/react-useanimations/main';
export const MOTION_LIBRARY_VERSION = '2026-10-29';

export const MOTION_LIBRARY: readonly MotionLibraryItem[] = [
  {
    "name": "checkCircle",
    "id": "ua-check-circle",
    "label": "Check en círculo",
    "category": "estado",
    "tags": [
      "ok",
      "confirmado",
      "listo"
    ],
    "bundled": true,
    "license": "MIT",
    "author": "useAnimations",
    "source": "https://github.com/useAnimations/react-useanimations",
    "fileUrl": "https://raw.githubusercontent.com/useAnimations/react-useanimations/main/icons/checkCircle.json",
    "sha256": "be3f0a05435e8c5a586ce2dd346c2a046fcacdfd5eaa89ebf3e0aa201545ca8c",
    "bytes": 2355,
    "width": 32,
    "height": 32,
    "fps": 30,
    "durationSeconds": 1.333
  },
  {
    "name": "alertCircle",
    "id": "ua-alert-circle",
    "label": "Alerta",
    "category": "estado",
    "tags": [
      "aviso",
      "error",
      "atención"
    ],
    "bundled": true,
    "license": "MIT",
    "author": "useAnimations",
    "source": "https://github.com/useAnimations/react-useanimations",
    "fileUrl": "https://raw.githubusercontent.com/useAnimations/react-useanimations/main/icons/alertCircle.json",
    "sha256": "44c61ede9d21bc71dfdf0283985549898cff767e83f619375ee6553fcb5781b2",
    "bytes": 2490,
    "width": 32,
    "height": 32,
    "fps": 30,
    "durationSeconds": 1.5
  },
  {
    "name": "heart",
    "id": "ua-heart",
    "label": "Corazón",
    "category": "estado",
    "tags": [
      "me gusta",
      "amor",
      "like"
    ],
    "bundled": true,
    "license": "MIT",
    "author": "useAnimations",
    "source": "https://github.com/useAnimations/react-useanimations",
    "fileUrl": "https://raw.githubusercontent.com/useAnimations/react-useanimations/main/icons/heart.json",
    "sha256": "8f3ea1c015bc07c147f3eeb775fd246013cdfd53681f4e33e6b87209d80265c2",
    "bytes": 2421,
    "width": 32,
    "height": 32,
    "fps": 30,
    "durationSeconds": 0.333
  },
  {
    "name": "star",
    "id": "ua-star",
    "label": "Estrella",
    "category": "estado",
    "tags": [
      "favorito",
      "rating"
    ],
    "bundled": true,
    "license": "MIT",
    "author": "useAnimations",
    "source": "https://github.com/useAnimations/react-useanimations",
    "fileUrl": "https://raw.githubusercontent.com/useAnimations/react-useanimations/main/icons/star.json",
    "sha256": "fa18d30e9cb1525d5b6fd6603898189493c1fb0441adda4abe6d188c67d09e86",
    "bytes": 2050,
    "width": 32,
    "height": 32,
    "fps": 30,
    "durationSeconds": 0.333
  },
  {
    "name": "zap",
    "id": "ua-zap",
    "label": "Rayo",
    "category": "general",
    "tags": [
      "energía",
      "rápido"
    ],
    "bundled": true,
    "license": "MIT",
    "author": "useAnimations",
    "source": "https://github.com/useAnimations/react-useanimations",
    "fileUrl": "https://raw.githubusercontent.com/useAnimations/react-useanimations/main/icons/zap.json",
    "sha256": "9009229c61d2e7532d94540fd871b6972971ce09d21464c3bac3d0ffc37c17d8",
    "bytes": 1624,
    "width": 32,
    "height": 32,
    "fps": 30,
    "durationSeconds": 1.133
  },
  {
    "name": "clock",
    "id": "ua-clock",
    "label": "Reloj",
    "category": "tiempo",
    "tags": [
      "tiempo",
      "hora"
    ],
    "bundled": true,
    "license": "MIT",
    "author": "useAnimations",
    "source": "https://github.com/useAnimations/react-useanimations",
    "fileUrl": "https://raw.githubusercontent.com/useAnimations/react-useanimations/main/icons/clock.json",
    "sha256": "b0517da59418526349ecdcf27f4b5b3b62c643e5a053e5b61c1ab3523db54819",
    "bytes": 2315,
    "width": 32,
    "height": 32,
    "fps": 30,
    "durationSeconds": 1.333
  },
  {
    "name": "mail",
    "id": "ua-mail",
    "label": "Correo",
    "category": "comunicación",
    "tags": [
      "email",
      "contacto"
    ],
    "bundled": true,
    "license": "MIT",
    "author": "useAnimations",
    "source": "https://github.com/useAnimations/react-useanimations",
    "fileUrl": "https://raw.githubusercontent.com/useAnimations/react-useanimations/main/icons/mail.json",
    "sha256": "821336f1d603744acee10aa65d7ebc2a532cfa33135d2d587885ac033d2f60a7",
    "bytes": 4351,
    "width": 32,
    "height": 32,
    "fps": 30,
    "durationSeconds": 0.667
  },
  {
    "name": "settings",
    "id": "ua-settings",
    "label": "Ajustes",
    "category": "sistema",
    "tags": [
      "engranaje",
      "config"
    ],
    "bundled": true,
    "license": "MIT",
    "author": "useAnimations",
    "source": "https://github.com/useAnimations/react-useanimations",
    "fileUrl": "https://raw.githubusercontent.com/useAnimations/react-useanimations/main/icons/settings.json",
    "sha256": "379db9d7b1788b1c6977fc40e1d06db6a0426f5ec8018659fb42940a7ab41ae1",
    "bytes": 3534,
    "width": 32,
    "height": 32,
    "fps": 30,
    "durationSeconds": 1.667
  },
  {
    "name": "download",
    "id": "ua-download",
    "label": "Descarga",
    "category": "sistema",
    "tags": [
      "bajar",
      "guardar"
    ],
    "bundled": true,
    "license": "MIT",
    "author": "useAnimations",
    "source": "https://github.com/useAnimations/react-useanimations",
    "fileUrl": "https://raw.githubusercontent.com/useAnimations/react-useanimations/main/icons/download.json",
    "sha256": "84ec5378485b944a52281730288db9cb7128fe5609f5d12add4772498cf3006c",
    "bytes": 6884,
    "width": 32,
    "height": 32,
    "fps": 30,
    "durationSeconds": 4
  },
  {
    "name": "upload",
    "id": "ua-upload",
    "label": "Subida",
    "category": "sistema",
    "tags": [
      "subir",
      "enviar"
    ],
    "bundled": true,
    "license": "MIT",
    "author": "useAnimations",
    "source": "https://github.com/useAnimations/react-useanimations",
    "fileUrl": "https://raw.githubusercontent.com/useAnimations/react-useanimations/main/icons/upload.json",
    "sha256": "364bce21e26ec75b5c52a529ac683e6dfdcf2d78d94ff7120afe128a9885b670",
    "bytes": 2060,
    "width": 32,
    "height": 32,
    "fps": 30,
    "durationSeconds": 1.333
  },
  {
    "name": "arrowRight",
    "id": "ua-arrow-right",
    "label": "Flecha derecha",
    "category": "general",
    "tags": [
      "siguiente",
      "dirección"
    ],
    "bundled": true,
    "license": "MIT",
    "author": "useAnimations",
    "source": "https://github.com/useAnimations/react-useanimations",
    "fileUrl": "https://raw.githubusercontent.com/useAnimations/react-useanimations/main/icons/arrowRight.json",
    "sha256": "69fee19fd66bf4f4939d7e4dbc1e593495ba3f37c77f49462c31a8da69557c74",
    "bytes": 1214,
    "width": 32,
    "height": 32,
    "fps": 30,
    "durationSeconds": 1.2
  },
  {
    "name": "gift",
    "id": "ua-gift",
    "label": "Regalo",
    "category": "general",
    "tags": [
      "sorteo",
      "premio"
    ],
    "bundled": true,
    "license": "MIT",
    "author": "useAnimations",
    "source": "https://github.com/useAnimations/react-useanimations",
    "fileUrl": "https://raw.githubusercontent.com/useAnimations/react-useanimations/main/icons/gift.json",
    "sha256": "71f1622f57022eeb6e77141cf4493c6538466b8d52b0e91a7d5ece698960b8aa",
    "bytes": 3272,
    "width": 32,
    "height": 32,
    "fps": 30,
    "durationSeconds": 1.333
  },
  {
    "name": "smile",
    "id": "ua-smile",
    "label": "Sonrisa",
    "category": "estado",
    "tags": [
      "feliz",
      "emoji"
    ],
    "bundled": false,
    "license": "MIT",
    "author": "useAnimations",
    "source": "https://github.com/useAnimations/react-useanimations",
    "fileUrl": "https://raw.githubusercontent.com/useAnimations/react-useanimations/main/icons/smile.json",
    "sha256": "abf44ecf416066ee07783e78d99da7fbad9ae1d3632a68414c9546f52501c350",
    "bytes": 3603,
    "width": 32,
    "height": 32,
    "fps": 30,
    "durationSeconds": 1.333
  },
  {
    "name": "info",
    "id": "ua-info",
    "label": "Información",
    "category": "estado",
    "tags": [
      "dato",
      "ayuda"
    ],
    "bundled": false,
    "license": "MIT",
    "author": "useAnimations",
    "source": "https://github.com/useAnimations/react-useanimations",
    "fileUrl": "https://raw.githubusercontent.com/useAnimations/react-useanimations/main/icons/info.json",
    "sha256": "c405080f9ce5c7935ee01b4b57dfcd78d446917a9723588a7b8bfed219b7be74",
    "bytes": 2489,
    "width": 32,
    "height": 32,
    "fps": 30,
    "durationSeconds": 0.333
  },
  {
    "name": "check",
    "id": "ua-check",
    "label": "Check",
    "category": "estado",
    "tags": [
      "ok",
      "tick"
    ],
    "bundled": false,
    "license": "MIT",
    "author": "useAnimations",
    "source": "https://github.com/useAnimations/react-useanimations",
    "fileUrl": "https://raw.githubusercontent.com/useAnimations/react-useanimations/main/icons/check.json",
    "sha256": "3599dd9ea8da6e54fdb655a0932809f342d83e2744e7e1bd70f1c85bfbbde4a6",
    "bytes": 2247,
    "width": 32,
    "height": 32,
    "fps": 30,
    "durationSeconds": 1.467
  },
  {
    "name": "lock",
    "id": "ua-lock",
    "label": "Candado",
    "category": "estado",
    "tags": [
      "seguro",
      "privado"
    ],
    "bundled": false,
    "license": "MIT",
    "author": "useAnimations",
    "source": "https://github.com/useAnimations/react-useanimations",
    "fileUrl": "https://raw.githubusercontent.com/useAnimations/react-useanimations/main/icons/lock.json",
    "sha256": "83ceee9f6a3efe301226f92371529194a3c7620863ddbf140e4f86f7d801eeff",
    "bytes": 1668,
    "width": 32,
    "height": 32,
    "fps": 30,
    "durationSeconds": 0.333
  },
  {
    "name": "messageCircle",
    "id": "ua-message-circle",
    "label": "Mensaje",
    "category": "comunicación",
    "tags": [
      "chat",
      "comentario"
    ],
    "bundled": false,
    "license": "MIT",
    "author": "useAnimations",
    "source": "https://github.com/useAnimations/react-useanimations",
    "fileUrl": "https://raw.githubusercontent.com/useAnimations/react-useanimations/main/icons/messageCircle.json",
    "sha256": "7927863d6845a7b57fee6801d071c606ff0668950017b91a4d73894ca7622d8f",
    "bytes": 1681,
    "width": 32,
    "height": 32,
    "fps": 30,
    "durationSeconds": 1.133
  },
  {
    "name": "send",
    "id": "ua-send",
    "label": "Enviar",
    "category": "comunicación",
    "tags": [
      "avión",
      "publicar"
    ],
    "bundled": false,
    "license": "MIT",
    "author": "useAnimations",
    "source": "https://github.com/useAnimations/react-useanimations",
    "fileUrl": "https://raw.githubusercontent.com/useAnimations/react-useanimations/main/icons/send.json",
    "sha256": "ff452b940c5576200505c3a6e28a2329ac760b06eff54b7bc827516214fa4a18",
    "bytes": 1230,
    "width": 32,
    "height": 32,
    "fps": 30,
    "durationSeconds": 1.333
  },
  {
    "name": "users",
    "id": "ua-users",
    "label": "Usuarios",
    "category": "comunicación",
    "tags": [
      "equipo",
      "comunidad"
    ],
    "bundled": false,
    "license": "MIT",
    "author": "useAnimations",
    "source": "https://github.com/useAnimations/react-useanimations",
    "fileUrl": "https://raw.githubusercontent.com/useAnimations/react-useanimations/main/icons/users.json",
    "sha256": "4a0435d3a99467e551fe5ec0902eb7211d35ebaedcd466645f7ac116395f9ea5",
    "bytes": 4265,
    "width": 32,
    "height": 32,
    "fps": 30,
    "durationSeconds": 1.267
  },
  {
    "name": "share",
    "id": "ua-share",
    "label": "Compartir",
    "category": "comunicación",
    "tags": [
      "redes",
      "social"
    ],
    "bundled": false,
    "license": "MIT",
    "author": "useAnimations",
    "source": "https://github.com/useAnimations/react-useanimations",
    "fileUrl": "https://raw.githubusercontent.com/useAnimations/react-useanimations/main/icons/share.json",
    "sha256": "de81f47a7f948b48011298efe6e84bd9e02e14ca9944dd6ef72a8c862ba51ff0",
    "bytes": 7209,
    "width": 32,
    "height": 32,
    "fps": 30,
    "durationSeconds": 2.5
  },
  {
    "name": "link",
    "id": "ua-link",
    "label": "Enlace",
    "category": "comunicación",
    "tags": [
      "url",
      "cadena"
    ],
    "bundled": false,
    "license": "MIT",
    "author": "useAnimations",
    "source": "https://github.com/useAnimations/react-useanimations",
    "fileUrl": "https://raw.githubusercontent.com/useAnimations/react-useanimations/main/icons/link.json",
    "sha256": "bf3115a7fb421e8a6a6073ac1d76fdb2aab7418627b956fce295cb901a72f4e1",
    "bytes": 2478,
    "width": 32,
    "height": 32,
    "fps": 30,
    "durationSeconds": 1.133
  },
  {
    "name": "globe",
    "id": "ua-globe",
    "label": "Globo",
    "category": "comunicación",
    "tags": [
      "mundo",
      "web"
    ],
    "bundled": false,
    "license": "MIT",
    "author": "useAnimations",
    "source": "https://github.com/useAnimations/react-useanimations",
    "fileUrl": "https://raw.githubusercontent.com/useAnimations/react-useanimations/main/icons/globe.json",
    "sha256": "d0ce2f725e49a9744caaa10f6378f8fe4c552579843faad16beded34440a8a82",
    "bytes": 1912,
    "width": 32,
    "height": 32,
    "fps": 30,
    "durationSeconds": 1.333
  },
  {
    "name": "camera",
    "id": "ua-camera",
    "label": "Cámara",
    "category": "media",
    "tags": [
      "foto",
      "grabar"
    ],
    "bundled": false,
    "license": "MIT",
    "author": "useAnimations",
    "source": "https://github.com/useAnimations/react-useanimations",
    "fileUrl": "https://raw.githubusercontent.com/useAnimations/react-useanimations/main/icons/camera.json",
    "sha256": "b642b79dce3bb7cc8d63e78188b70837c6158a8df77ca0fe7fb9f8cba29f6cc0",
    "bytes": 2261,
    "width": 32,
    "height": 32,
    "fps": 30,
    "durationSeconds": 1.133
  },
  {
    "name": "video",
    "id": "ua-video",
    "label": "Video",
    "category": "media",
    "tags": [
      "film",
      "clip"
    ],
    "bundled": false,
    "license": "MIT",
    "author": "useAnimations",
    "source": "https://github.com/useAnimations/react-useanimations",
    "fileUrl": "https://raw.githubusercontent.com/useAnimations/react-useanimations/main/icons/video.json",
    "sha256": "8d1912e792db428e6d8a9f79b29b3889989ee6ec80ca79a7bf67ca5f5664f2e6",
    "bytes": 2659,
    "width": 32,
    "height": 32,
    "fps": 30,
    "durationSeconds": 0.533
  },
  {
    "name": "image",
    "id": "ua-image",
    "label": "Imagen",
    "category": "media",
    "tags": [
      "foto",
      "cuadro"
    ],
    "bundled": false,
    "license": "MIT",
    "author": "useAnimations",
    "source": "https://github.com/useAnimations/react-useanimations",
    "fileUrl": "https://raw.githubusercontent.com/useAnimations/react-useanimations/main/icons/image.json",
    "sha256": "e9ae85fa5e5de8813ab6ee67d8e355d222008130747e4a3a1c47aac6504f6ff1",
    "bytes": 2889,
    "width": 32,
    "height": 32,
    "fps": 30,
    "durationSeconds": 1.2
  },
  {
    "name": "music",
    "id": "ua-music",
    "label": "Música",
    "category": "media",
    "tags": [
      "nota",
      "audio"
    ],
    "bundled": false,
    "license": "MIT",
    "author": "useAnimations",
    "source": "https://github.com/useAnimations/react-useanimations",
    "fileUrl": "https://raw.githubusercontent.com/useAnimations/react-useanimations/main/icons/music.json",
    "sha256": "0c947102e0e54d0cb349a76cda887d83ea779eb721a711b4ec4cdb3124905eda",
    "bytes": 2033,
    "width": 32,
    "height": 32,
    "fps": 30,
    "durationSeconds": 1.333
  },
  {
    "name": "bookmark",
    "id": "ua-bookmark",
    "label": "Marcador",
    "category": "media",
    "tags": [
      "guardar",
      "favorito"
    ],
    "bundled": false,
    "license": "MIT",
    "author": "useAnimations",
    "source": "https://github.com/useAnimations/react-useanimations",
    "fileUrl": "https://raw.githubusercontent.com/useAnimations/react-useanimations/main/icons/bookmark.json",
    "sha256": "e921698ec1da05393f70d0a09e2b5c2fe6539bf5b929a1cf696cb3bc45239528",
    "bytes": 1886,
    "width": 32,
    "height": 32,
    "fps": 30,
    "durationSeconds": 0.333
  },
  {
    "name": "barChart",
    "id": "ua-bar-chart",
    "label": "Barras",
    "category": "datos",
    "tags": [
      "gráfico",
      "estadística"
    ],
    "bundled": false,
    "license": "MIT",
    "author": "useAnimations",
    "source": "https://github.com/useAnimations/react-useanimations",
    "fileUrl": "https://raw.githubusercontent.com/useAnimations/react-useanimations/main/icons/barChart.json",
    "sha256": "84d17f68efaa1e613dc315d0e31b587af9702dc2ace8c6970245121dd366ad40",
    "bytes": 3368,
    "width": 32,
    "height": 32,
    "fps": 30,
    "durationSeconds": 1.333
  },
  {
    "name": "pieChart",
    "id": "ua-pie-chart",
    "label": "Torta",
    "category": "datos",
    "tags": [
      "gráfico",
      "porcentaje"
    ],
    "bundled": false,
    "license": "MIT",
    "author": "useAnimations",
    "source": "https://github.com/useAnimations/react-useanimations",
    "fileUrl": "https://raw.githubusercontent.com/useAnimations/react-useanimations/main/icons/pieChart.json",
    "sha256": "00b83686b74cdd60d70bbd3fe419b0f4ebdc24fc66e6d0d527a2c5d12e059935",
    "bytes": 1792,
    "width": 32,
    "height": 32,
    "fps": 30,
    "durationSeconds": 1.133
  },
  {
    "name": "trendingUp",
    "id": "ua-trending-up",
    "label": "Tendencia",
    "category": "datos",
    "tags": [
      "subida",
      "crecimiento"
    ],
    "bundled": false,
    "license": "MIT",
    "author": "useAnimations",
    "source": "https://github.com/useAnimations/react-useanimations",
    "fileUrl": "https://raw.githubusercontent.com/useAnimations/react-useanimations/main/icons/trendingUp.json",
    "sha256": "ce40119a6b06dd7f92c634b49f85ecafb15841dca2ed788c87f6ca08274f7738",
    "bytes": 1940,
    "width": 32,
    "height": 32,
    "fps": 30,
    "durationSeconds": 1.333
  },
  {
    "name": "activity",
    "id": "ua-activity",
    "label": "Actividad",
    "category": "datos",
    "tags": [
      "pulso",
      "métrica"
    ],
    "bundled": false,
    "license": "MIT",
    "author": "useAnimations",
    "source": "https://github.com/useAnimations/react-useanimations",
    "fileUrl": "https://raw.githubusercontent.com/useAnimations/react-useanimations/main/icons/activity.json",
    "sha256": "11ed110df4ab1cb434a526725884129a10914536d09e701feed129fd263f719e",
    "bytes": 1759,
    "width": 32,
    "height": 32,
    "fps": 30,
    "durationSeconds": 1.333
  },
  {
    "name": "target",
    "id": "ua-target",
    "label": "Objetivo",
    "category": "datos",
    "tags": [
      "meta",
      "diana"
    ],
    "bundled": false,
    "license": "MIT",
    "author": "useAnimations",
    "source": "https://github.com/useAnimations/react-useanimations",
    "fileUrl": "https://raw.githubusercontent.com/useAnimations/react-useanimations/main/icons/target.json",
    "sha256": "e82ab3627a53b43fee4050cf56ed2c1678612aa65dfb5562e2882dfd5fa4ba2f",
    "bytes": 3266,
    "width": 32,
    "height": 32,
    "fps": 30,
    "durationSeconds": 1.2
  },
  {
    "name": "layers",
    "id": "ua-layers",
    "label": "Capas",
    "category": "datos",
    "tags": [
      "stack",
      "niveles"
    ],
    "bundled": false,
    "license": "MIT",
    "author": "useAnimations",
    "source": "https://github.com/useAnimations/react-useanimations",
    "fileUrl": "https://raw.githubusercontent.com/useAnimations/react-useanimations/main/icons/layers.json",
    "sha256": "4beabc90778bfc321572f261b0330f425c6e4c37416ae2648ab621216c6dec56",
    "bytes": 3100,
    "width": 32,
    "height": 32,
    "fps": 30,
    "durationSeconds": 1.333
  },
  {
    "name": "cpu",
    "id": "ua-cpu",
    "label": "CPU",
    "category": "datos",
    "tags": [
      "chip",
      "proceso"
    ],
    "bundled": false,
    "license": "MIT",
    "author": "useAnimations",
    "source": "https://github.com/useAnimations/react-useanimations",
    "fileUrl": "https://raw.githubusercontent.com/useAnimations/react-useanimations/main/icons/cpu.json",
    "sha256": "08ac31d2c7a526f5e45ac077bcf954b137b6ce32477db20786990c53426f7b50",
    "bytes": 5341,
    "width": 32,
    "height": 32,
    "fps": 30,
    "durationSeconds": 1.333
  },
  {
    "name": "calendar",
    "id": "ua-calendar",
    "label": "Calendario",
    "category": "tiempo",
    "tags": [
      "fecha",
      "agenda"
    ],
    "bundled": false,
    "license": "MIT",
    "author": "useAnimations",
    "source": "https://github.com/useAnimations/react-useanimations",
    "fileUrl": "https://raw.githubusercontent.com/useAnimations/react-useanimations/main/icons/calendar.json",
    "sha256": "efc0a075571d96d7a7af218193e29445c9326e85a815713e5a61863b32619d00",
    "bytes": 3244,
    "width": 32,
    "height": 32,
    "fps": 30,
    "durationSeconds": 0.267
  },
  {
    "name": "wifi",
    "id": "ua-wifi",
    "label": "WiFi",
    "category": "sistema",
    "tags": [
      "red",
      "señal"
    ],
    "bundled": false,
    "license": "MIT",
    "author": "useAnimations",
    "source": "https://github.com/useAnimations/react-useanimations",
    "fileUrl": "https://raw.githubusercontent.com/useAnimations/react-useanimations/main/icons/wifi.json",
    "sha256": "f576b0fcdebd55bed69e17b0c59c82cebedeb5ff8a4d2690224e87100e0f22ca",
    "bytes": 4365,
    "width": 32,
    "height": 32,
    "fps": 30,
    "durationSeconds": 1.333
  },
  {
    "name": "battery",
    "id": "ua-battery",
    "label": "Batería",
    "category": "sistema",
    "tags": [
      "energía",
      "carga"
    ],
    "bundled": false,
    "license": "MIT",
    "author": "useAnimations",
    "source": "https://github.com/useAnimations/react-useanimations",
    "fileUrl": "https://raw.githubusercontent.com/useAnimations/react-useanimations/main/icons/battery.json",
    "sha256": "c36eebd9ac28f4f3a8961a2636bce4a2a205c06596c2071fcf69b95d981718d1",
    "bytes": 4960,
    "width": 32,
    "height": 32,
    "fps": 30,
    "durationSeconds": 1.467
  },
  {
    "name": "sun",
    "id": "ua-sun",
    "label": "Sol",
    "category": "general",
    "tags": [
      "día",
      "clima"
    ],
    "bundled": false,
    "license": "MIT",
    "author": "useAnimations",
    "source": "https://github.com/useAnimations/react-useanimations",
    "fileUrl": "https://raw.githubusercontent.com/useAnimations/react-useanimations/main/icons/sun.json",
    "sha256": "5ad464eb5790118f4c2998eab4d33b871cac095947a5ea40c18b5dbe2ddebda1",
    "bytes": 2671,
    "width": 32,
    "height": 32,
    "fps": 30,
    "durationSeconds": 1.333
  },
  {
    "name": "moon",
    "id": "ua-moon",
    "label": "Luna",
    "category": "general",
    "tags": [
      "noche",
      "clima"
    ],
    "bundled": false,
    "license": "MIT",
    "author": "useAnimations",
    "source": "https://github.com/useAnimations/react-useanimations",
    "fileUrl": "https://raw.githubusercontent.com/useAnimations/react-useanimations/main/icons/moon.json",
    "sha256": "5c3787c32c45e5c04b3a5fd5ac4338e648d81b2f119b500744301836a5e9e1a8",
    "bytes": 1520,
    "width": 32,
    "height": 32,
    "fps": 30,
    "durationSeconds": 1.333
  },
  {
    "name": "award",
    "id": "ua-award",
    "label": "Premio",
    "category": "general",
    "tags": [
      "medalla",
      "logro"
    ],
    "bundled": false,
    "license": "MIT",
    "author": "useAnimations",
    "source": "https://github.com/useAnimations/react-useanimations",
    "fileUrl": "https://raw.githubusercontent.com/useAnimations/react-useanimations/main/icons/award.json",
    "sha256": "2589871cad162a3d558480e2042b7fb9a2de43e8e3574d94ec11660b861b0365",
    "bytes": 2743,
    "width": 32,
    "height": 32,
    "fps": 30,
    "durationSeconds": 1.333
  },
  {
    "name": "chevronRight",
    "id": "ua-chevron-right",
    "label": "Chevron",
    "category": "general",
    "tags": [
      "siguiente",
      "flecha"
    ],
    "bundled": false,
    "license": "MIT",
    "author": "useAnimations",
    "source": "https://github.com/useAnimations/react-useanimations",
    "fileUrl": "https://raw.githubusercontent.com/useAnimations/react-useanimations/main/icons/chevronRight.json",
    "sha256": "5005287f94c0032619eb9faf7e2764c502d62e728ac89216dc2e3944042d6530",
    "bytes": 2689,
    "width": 32,
    "height": 32,
    "fps": 29.9700012207031,
    "durationSeconds": 1.001
  },
  {
    "name": "youtube",
    "id": "ua-youtube",
    "label": "YouTube",
    "category": "marcas",
    "tags": [
      "marca",
      "video",
      "red social",
      "cta"
    ],
    "bundled": false,
    "license": "MIT",
    "author": "useAnimations",
    "source": "https://github.com/useAnimations/react-useanimations",
    "fileUrl": "https://raw.githubusercontent.com/useAnimations/react-useanimations/main/icons/youtube.json",
    "sha256": "32e5d6f7c3ac79b9dadf1730c3011626a1ee22222e93dd65387d3cf4aad61eb3",
    "bytes": 8227,
    "width": 32,
    "height": 32,
    "fps": 30.0003051757812,
    "durationSeconds": 1
  },
  {
    "name": "instagram",
    "id": "ua-instagram",
    "label": "Instagram",
    "category": "marcas",
    "tags": [
      "marca",
      "red social",
      "foto"
    ],
    "bundled": false,
    "license": "MIT",
    "author": "useAnimations",
    "source": "https://github.com/useAnimations/react-useanimations",
    "fileUrl": "https://raw.githubusercontent.com/useAnimations/react-useanimations/main/icons/instagram.json",
    "sha256": "552e0843230c2f6581aecb10cd39b0da160c9f955e13a19b51b4260fc45f6ec9",
    "bytes": 5647,
    "width": 32,
    "height": 32,
    "fps": 30,
    "durationSeconds": 0.333
  },
  {
    "name": "facebook",
    "id": "ua-facebook",
    "label": "Facebook",
    "category": "marcas",
    "tags": [
      "marca",
      "red social"
    ],
    "bundled": false,
    "license": "MIT",
    "author": "useAnimations",
    "source": "https://github.com/useAnimations/react-useanimations",
    "fileUrl": "https://raw.githubusercontent.com/useAnimations/react-useanimations/main/icons/facebook.json",
    "sha256": "319910942a6cae6ab1dd6b3f78fec36bbe6e3a1836962f0e3cb484746577deb9",
    "bytes": 1347,
    "width": 32,
    "height": 32,
    "fps": 30,
    "durationSeconds": 2
  },
  {
    "name": "linkedin",
    "id": "ua-linkedin",
    "label": "LinkedIn",
    "category": "marcas",
    "tags": [
      "marca",
      "red social",
      "profesional"
    ],
    "bundled": false,
    "license": "MIT",
    "author": "useAnimations",
    "source": "https://github.com/useAnimations/react-useanimations",
    "fileUrl": "https://raw.githubusercontent.com/useAnimations/react-useanimations/main/icons/linkedin.json",
    "sha256": "dd7b315f78d5c09137941dccef894b68708b3ac28570169f0ca56df7b828f7f7",
    "bytes": 2425,
    "width": 32,
    "height": 32,
    "fps": 30,
    "durationSeconds": 0.433
  },
  {
    "name": "twitch",
    "id": "ua-twitch",
    "label": "Twitch",
    "category": "marcas",
    "tags": [
      "marca",
      "stream",
      "directo"
    ],
    "bundled": false,
    "license": "MIT",
    "author": "useAnimations",
    "source": "https://github.com/useAnimations/react-useanimations",
    "fileUrl": "https://raw.githubusercontent.com/useAnimations/react-useanimations/main/icons/twitch.json",
    "sha256": "9a84af024332f103366c4adf260f678b96d8a25cf55fa8c915cdc4687fb06e70",
    "bytes": 2261,
    "width": 32,
    "height": 32,
    "fps": 30,
    "durationSeconds": 1.333
  },
  {
    "name": "github",
    "id": "ua-github",
    "label": "GitHub",
    "category": "marcas",
    "tags": [
      "marca",
      "código",
      "repo"
    ],
    "bundled": false,
    "license": "MIT",
    "author": "useAnimations",
    "source": "https://github.com/useAnimations/react-useanimations",
    "fileUrl": "https://raw.githubusercontent.com/useAnimations/react-useanimations/main/icons/github.json",
    "sha256": "04960b6404353219a3a0ad33c48c667483425f3b591ec92de20d9774a2b903ac",
    "bytes": 3258,
    "width": 32,
    "height": 32,
    "fps": 30,
    "durationSeconds": 1
  },
  {
    "name": "figma",
    "id": "ua-figma",
    "label": "Figma",
    "category": "marcas",
    "tags": [
      "marca",
      "diseño",
      "ui"
    ],
    "bundled": false,
    "license": "MIT",
    "author": "useAnimations",
    "source": "https://github.com/useAnimations/react-useanimations",
    "fileUrl": "https://raw.githubusercontent.com/useAnimations/react-useanimations/main/icons/figma.json",
    "sha256": "87e80d63a2965859e108855e0735bb3fec7b963788029c4f8f7df1ad7a3a6d4b",
    "bytes": 5451,
    "width": 32,
    "height": 32,
    "fps": 30,
    "durationSeconds": 1.333
  },
  {
    "name": "slack",
    "id": "ua-slack",
    "label": "Slack",
    "category": "marcas",
    "tags": [
      "marca",
      "equipo",
      "chat"
    ],
    "bundled": false,
    "license": "MIT",
    "author": "useAnimations",
    "source": "https://github.com/useAnimations/react-useanimations",
    "fileUrl": "https://raw.githubusercontent.com/useAnimations/react-useanimations/main/icons/slack.json",
    "sha256": "45ae0051bdb29158541caae94a902ef89c0a3d34c8106c7f7573ffc7bbad6985",
    "bytes": 2373,
    "width": 32,
    "height": 32,
    "fps": 30,
    "durationSeconds": 1.2
  },
  {
    "name": "discord",
    "id": "ua-discord",
    "label": "Discord",
    "category": "marcas",
    "tags": [
      "marca",
      "comunidad",
      "chat"
    ],
    "bundled": false,
    "license": "MIT",
    "author": "useAnimations",
    "source": "https://github.com/useAnimations/react-useanimations",
    "fileUrl": "https://raw.githubusercontent.com/useAnimations/react-useanimations/main/icons/discord.json",
    "sha256": "bd8421c41690fa06eb85c13a3199e9c97c5b526a0973846b072e535d27d396e2",
    "bytes": 3976,
    "width": 32,
    "height": 32,
    "fps": 30,
    "durationSeconds": 1.6
  },
  {
    "name": "telegram",
    "id": "ua-telegram",
    "label": "Telegram",
    "category": "marcas",
    "tags": [
      "marca",
      "chat",
      "canal"
    ],
    "bundled": false,
    "license": "MIT",
    "author": "useAnimations",
    "source": "https://github.com/useAnimations/react-useanimations",
    "fileUrl": "https://raw.githubusercontent.com/useAnimations/react-useanimations/main/icons/telegram.json",
    "sha256": "ab926a060811bbbef1c10ba8d98be0cf736e5a17c25bac2be2773749f1895bef",
    "bytes": 1177,
    "width": 32,
    "height": 32,
    "fps": 30,
    "durationSeconds": 1.333
  },
  {
    "name": "behance",
    "id": "ua-behance",
    "label": "Behance",
    "category": "marcas",
    "tags": [
      "marca",
      "portafolio",
      "diseño"
    ],
    "bundled": false,
    "license": "MIT",
    "author": "useAnimations",
    "source": "https://github.com/useAnimations/react-useanimations",
    "fileUrl": "https://raw.githubusercontent.com/useAnimations/react-useanimations/main/icons/behance.json",
    "sha256": "903dab6dc0e7cf5c8b2b943980d976ceddb84a75cef56d409cdd9e582fd09cff",
    "bytes": 2693,
    "width": 32,
    "height": 32,
    "fps": 30,
    "durationSeconds": 1.5
  }
] as const;
