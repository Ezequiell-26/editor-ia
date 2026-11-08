import { createContext } from 'react';
import type { ProjectStoreValue } from './project-store-types';



export const ProjectContext = createContext<ProjectStoreValue | null>(null);

/**
 * El playhead y el estado de reproducci├│n viven en contextos separados del
 * proyecto: cambian ~30-60 veces por segundo durante la reproducci├│n y antes
 * invalidaban a los ~100 consumidores de `useProjectStore` (men├║, barra
 * lateral, dock del asistente, cromo completo) en cada frame. Ahora s├│lo se
 * re-renderizan quienes leen estos contextos; los handlers usan
 * `getPlayhead()`/`getPlaying()` que leen un ref sin suscribir nada.
 */
export const PlayheadContext = createContext<number>(0);

export const PlayingContext = createContext<boolean>(false);

export const PlaybackRateContext = createContext<number>(1);
