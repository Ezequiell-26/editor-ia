import type {
  ExportShortRequest,
  ExportShortResult,
} from '../../services/project-service';
import type { ShortCandidate } from './shorts';

export interface ShortBatchContext {
  readonly videoPath: string;
  readonly outputDir: string;
  readonly smartReframe: boolean;
}

export interface ShortBatchProgress {
  /** Índice 1-based del candidato que se está exportando. */
  readonly index: number;
  readonly total: number;
  readonly candidateId: string;
  readonly title: string;
}

export interface ShortBatchOutcome {
  readonly candidateId: string;
  readonly title: string;
  readonly ok: boolean;
  readonly result?: ExportShortResult;
  readonly error?: string;
}

/**
 * Exporta los candidatos de Auto Shorts de forma secuencial, con una sola
 * carpeta elegida por el usuario. Un fallo no cancela los siguientes: cada
 * resultado se informa por separado para que el lote sea auditable.
 */
export async function runShortBatch(
  candidates: readonly ShortCandidate[],
  context: ShortBatchContext,
  exportOne: (request: ExportShortRequest) => Promise<ExportShortResult>,
  onProgress?: (progress: ShortBatchProgress) => void,
): Promise<ShortBatchOutcome[]> {
  const outcomes: ShortBatchOutcome[] = [];
  const total = candidates.length;
  for (const [offset, candidate] of candidates.entries()) {
    onProgress?.({
      index: offset + 1,
      total,
      candidateId: candidate.id,
      title: candidate.title,
    });
    try {
      const result = await exportOne({
        path: context.videoPath,
        outputDir: context.outputDir,
        startSeconds: candidate.startSeconds,
        endSeconds: candidate.endSeconds,
        label: candidate.title,
        smartReframe: context.smartReframe,
      });
      outcomes.push({
        candidateId: candidate.id,
        title: candidate.title,
        ok: true,
        result,
      });
    } catch (cause) {
      outcomes.push({
        candidateId: candidate.id,
        title: candidate.title,
        ok: false,
        error:
          cause instanceof Error
            ? cause.message
            : 'no se pudo exportar este short',
      });
    }
  }
  return outcomes;
}
