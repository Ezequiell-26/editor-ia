/**
 * Validación visible del archivo exportado con FFprobe.
 *
 * No reemplaza la validación del backend: contrasta el resultado real (probe)
 * contra lo que el perfil prometía para que el usuario vea mismatches en vez de
 * un "Render completado" a ciegas. Si FFprobe no está disponible (navegador),
 * se informa honestamente y no se inventan checks.
 */
export interface ExportProbe {
  readonly bytes: number;
  readonly durationSeconds: number | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly videoCodec: string | null;
  readonly audioCodec: string | null;
  readonly formatName: string | null;
}

export interface ExportExpectation {
  readonly videoCodec: string;
  readonly audioCodec: string;
  readonly width: number;
  readonly height: number;
  readonly durationSeconds: number;
  readonly expectedBytes?: number | null;
}

export type ExportValidationLevel = 'ok' | 'warn' | 'error';

export interface ExportValidationFinding {
  readonly level: ExportValidationLevel;
  readonly label: string;
  readonly detail: string;
}

export interface ExportValidationReport {
  readonly status: 'pass' | 'warn' | 'fail';
  readonly findings: readonly ExportValidationFinding[];
}

const CODEC_ALIASES: Record<string, string> = {
  h264: 'h264',
  avc: 'h264',
  avc1: 'h264',
  h265: 'hevc',
  hevc: 'hevc',
  hvc1: 'hevc',
  aac: 'aac',
  mp4a: 'aac',
  pcm: 'pcm',
};

function normalizeCodec(value: string | null | undefined): string {
  const codec = (value ?? '').toLowerCase().trim();
  return CODEC_ALIASES[codec] ?? codec;
}

function closeEnough(actual: number | null, expected: number, tolerance: number): boolean {
  if (actual === null || !Number.isFinite(actual) || actual <= 0) return false;
  return Math.abs(actual - expected) <= tolerance;
}

export function validateExportFile(
  probe: ExportProbe,
  expected: ExportExpectation,
): ExportValidationReport {
  const findings: ExportValidationFinding[] = [];
  const push = (level: ExportValidationLevel, label: string, detail: string): void => {
    findings.push({ level, label, detail });
  };

  if (probe.bytes > 0) {
    push('ok', 'Archivo escrito', `${probe.bytes.toLocaleString('es-AR')} bytes`);
  } else {
    push('error', 'Archivo vacío', 'el render no escribió bytes');
  }

  if (probe.width !== null && probe.height !== null) {
    if (probe.width === expected.width && probe.height === expected.height) {
      push('ok', 'Resolución', `${probe.width}×${probe.height}`);
    } else {
      push(
        'warn',
        'Resolución distinta',
        `FFprobe ${probe.width}×${probe.height} · perfil ${expected.width}×${expected.height}`,
      );
    }
  } else {
    push('warn', 'Resolución', 'FFprobe no reportó dimensiones de video');
  }

  const expectedVideo = normalizeCodec(expected.videoCodec);
  const actualVideo = normalizeCodec(probe.videoCodec);
  if (probe.videoCodec === null) {
    push('warn', 'Códec de video', 'FFprobe no reportó códec de video');
  } else if (actualVideo === expectedVideo) {
    push('ok', 'Códec de video', actualVideo);
  } else {
    push('warn', 'Códec distinto', `FFprobe ${actualVideo} · perfil ${expectedVideo}`);
  }

  const expectedAudio = normalizeCodec(expected.audioCodec);
  const actualAudio = normalizeCodec(probe.audioCodec);
  if (probe.audioCodec === null) {
    push('warn', 'Audio', 'no hay pista de audio en el archivo exportado');
  } else if (actualAudio === expectedAudio) {
    push('ok', 'Códec de audio', actualAudio);
  } else {
    push('warn', 'Audio distinto', `FFprobe ${actualAudio} · perfil ${expectedAudio}`);
  }

  if (
    expected.durationSeconds > 0 &&
    closeEnough(probe.durationSeconds, expected.durationSeconds, Math.max(0.35, expected.durationSeconds * 0.01))
  ) {
    push('ok', 'Duración', `${(probe.durationSeconds ?? 0).toFixed(2)} s`);
  } else if (probe.durationSeconds !== null) {
    push(
      'warn',
      'Duración distinta',
      `FFprobe ${probe.durationSeconds.toFixed(2)} s · esperada ${expected.durationSeconds.toFixed(2)} s`,
    );
  } else {
    push('warn', 'Duración', 'FFprobe no reportó duración');
  }

  if (typeof expected.expectedBytes === 'number' && expected.expectedBytes > 0) {
    if (closeEnough(probe.bytes, expected.expectedBytes, Math.max(1024, expected.expectedBytes * 0.02))) {
      push('ok', 'Tamaño', 'coincide con el reportado por el render');
    } else {
      push(
        'warn',
        'Tamaño distinto',
        `archivo ${probe.bytes} B · render ${expected.expectedBytes} B`,
      );
    }
  }

  const hasError = findings.some((finding) => finding.level === 'error');
  const hasWarn = findings.some((finding) => finding.level === 'warn');
  return {
    status: hasError ? 'fail' : hasWarn ? 'warn' : 'pass',
    findings,
  };
}

/**
 * Variante para `verifyExport`: incluye fps, pixel format, bitrates, color y
 * HDR reales reportados por FFprobe. Reusa la misma semántica de hallazgos que
 * `validateExportFile` (ok/warn/error, sin inventar checks ausentes).
 */
export interface ExportVerificationLike {
  readonly container: string;
  readonly videoCodec: string | null;
  readonly audioCodec: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly fpsNum: number;
  readonly fpsDen: number;
  readonly pixelFormat: string | null;
  readonly videoBitrate: number | null;
  readonly audioBitrate: number | null;
  readonly colorSpace: string | null;
  readonly colorTransfer: string | null;
  readonly colorPrimaries: string | null;
  readonly hdr: boolean;
  readonly durationSeconds: number | null;
  readonly bytes: number;
  readonly warnings?: readonly string[];
}

export function validateExportVerification(
  verification: ExportVerificationLike,
  expected: ExportExpectation,
): ExportValidationReport {
  const findings: ExportValidationFinding[] = [];
  const push = (level: ExportValidationLevel, label: string, detail: string): void => {
    findings.push({ level, label, detail });
  };

  if (verification.bytes > 0) {
    push('ok', 'Archivo escrito', `${verification.bytes.toLocaleString('es-AR')} bytes`);
  } else {
    push('error', 'Archivo vacío', 'el render no escribió bytes');
  }

  if (verification.width !== null && verification.height !== null) {
    if (verification.width === expected.width && verification.height === expected.height) {
      push('ok', 'Resolución', `${verification.width}×${verification.height}`);
    } else {
      push('warn', 'Resolución distinta', `FFprobe ${verification.width}×${verification.height} · perfil ${expected.width}×${expected.height}`);
    }
  } else {
    push('warn', 'Resolución', 'FFprobe no reportó dimensiones de video');
  }

  const actualVideo = normalizeCodec(verification.videoCodec);
  if (verification.videoCodec === null) push('warn', 'Códec de video', 'FFprobe no reportó códec');
  else if (actualVideo === normalizeCodec(expected.videoCodec)) push('ok', 'Códec de video', actualVideo);
  else push('warn', 'Códec distinto', `FFprobe ${actualVideo} · perfil ${normalizeCodec(expected.videoCodec)}`);

  const actualAudio = normalizeCodec(verification.audioCodec);
  if (verification.audioCodec === null) push('warn', 'Audio', 'no hay pista de audio');
  else if (actualAudio === normalizeCodec(expected.audioCodec)) push('ok', 'Códec de audio', actualAudio);
  else push('warn', 'Audio distinto', `FFprobe ${actualAudio} · perfil ${normalizeCodec(expected.audioCodec)}`);

  if (verification.fpsDen > 0 && verification.fpsNum > 0) {
    push('ok', 'FPS', `${(verification.fpsNum / verification.fpsDen).toFixed(3)} fps`);
  }
  if (verification.pixelFormat) push('ok', 'Pixel format', verification.pixelFormat);
  if (verification.colorSpace || verification.colorPrimaries) {
    push('ok', 'Color', `${verification.colorSpace ?? '—'} · ${verification.colorPrimaries ?? '—'}`);
  }
  // El build actual no inyecta HDR: si el archivo reporta HDR es una advertencia
  // para el usuario (no se ofreció HDR en la UI).
  if (verification.hdr) push('warn', 'HDR', 'el archivo reporta HDR; este build exporta SDR');
  else push('ok', 'Rango dinámico', 'SDR');

  if (verification.durationSeconds !== null) {
    const tolerance = Math.max(0.35, expected.durationSeconds * 0.01);
    if (Math.abs(verification.durationSeconds - expected.durationSeconds) <= tolerance) {
      push('ok', 'Duración', `${verification.durationSeconds.toFixed(2)} s`);
    } else {
      push('warn', 'Duración distinta', `FFprobe ${verification.durationSeconds.toFixed(2)} s · esperada ${expected.durationSeconds.toFixed(2)} s`);
    }
  }

  for (const warning of verification.warnings ?? []) {
    push('warn', 'Aviso de FFprobe', warning);
  }

  const hasError = findings.some((entry) => entry.level === 'error');
  const hasWarn = findings.some((entry) => entry.level === 'warn');
  return { status: hasError ? 'fail' : hasWarn ? 'warn' : 'pass', findings };
}
