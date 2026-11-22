// Re-export: la conversión tracking→máscara vive en `state/face-mask.ts`
// (pura) para compartirla con la UI y el dispatcher MCP sin importar
// features desde state/.
export { maskFromFaceTrack, polygonAroundCenter } from '../../state/face-mask';
