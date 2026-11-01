/**
 * Presets de proveedores OpenAI-compatible. Rellenan URL y modelo para que el
 * usuario sólo pegue su clave; la app no guarda claves fuera del almacén de
 * Windows.
 */

export interface ProviderPreset {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly baseUrl: string;
  readonly model: string;
  /** Dónde se obtiene la clave. */
  readonly keysUrl: string;
  /** Prefijo esperado de la clave, sólo como ayuda visual. */
  readonly keyHint: string;
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    id: 'nvidia-nim',
    label: 'NVIDIA NIM · DeepSeek V4.1 Flash',
    hint: 'API OpenAI-compatible de NVIDIA Build. Pegá una clave nvapi-…',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    model: 'deepseek-ai/deepseek-v4.1-flash',
    keysUrl: 'https://build.nvidia.com/deepseek-ai/deepseek-v4.1-flash',
    keyHint: 'nvapi-…',
  },
  {
    id: 'freellmapi',
    label: 'FreeLLMAPI local',
    hint: 'Gateway local en 127.0.0.1 con modelo «auto». Tiene que estar abierto.',
    baseUrl: 'http://127.0.0.1:31415/v1',
    model: 'auto',
    keysUrl: '',
    keyHint: 'clave del gateway',
  },
];

export function presetById(id: string): ProviderPreset | null {
  return PROVIDER_PRESETS.find((preset) => preset.id === id) ?? null;
}
