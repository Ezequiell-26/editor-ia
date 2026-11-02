import { describe, expect, it } from 'vitest';
import {
  AI_PROVIDERS,
  brandForEndpoint,
  brandForModel,
  detectAiBrand,
  endpointLabel,
  providerPreset,
  suggestedModels,
} from './ai-models';

describe('catálogo de proveedores de IA', () => {
  it('cada preset declara endpoint, modelo por defecto y notas', () => {
    for (const preset of AI_PROVIDERS) {
      expect(preset.baseUrl).toBeTruthy();
      expect(preset.label).toBeTruthy();
      expect(preset.note).toBeTruthy();
      expect(preset.models).toContain(preset.model);
    }
  });

  it('no repite identificadores ni endpoints', () => {
    const ids = new Set(AI_PROVIDERS.map((preset) => preset.id));
    const urls = new Set(AI_PROVIDERS.map((preset) => preset.baseUrl.toLowerCase()));
    expect(ids.size).toBe(AI_PROVIDERS.length);
    expect(urls.size).toBe(AI_PROVIDERS.length);
  });

  it('se puede recuperar un preset por id', () => {
    const ollama = providerPreset('ollama');
    expect(ollama?.local).toBe(true);
    expect(ollama?.baseUrl).toContain(':11434');
    expect(providerPreset('no-existe')).toBeUndefined();
  });
});

describe('detección de marca por endpoint', () => {
  it('reconoce los endpoints conocidos sin importar la ruta final', () => {
    expect(brandForEndpoint('https://api.openai.com/v1')).toBe('openai');
    expect(brandForEndpoint('https://generativelanguage.googleapis.com/v1beta/openai/')).toBe(
      'google',
    );
    expect(brandForEndpoint('https://api.deepseek.com/v1')).toBe('deepseek');
    expect(brandForEndpoint('https://openrouter.ai/api/v1')).toBe('openrouter');
    expect(brandForEndpoint('http://127.0.0.1:11434/v1')).toBe('ollama');
    expect(brandForEndpoint('http://localhost:1234/v1')).toBe('lmstudio');
    expect(brandForEndpoint('https://mi-recurso.openai.azure.com/openai/v1')).toBe('azure');
  });

  it('tolera barra final y mayúsculas', () => {
    expect(brandForEndpoint('HTTPS://API.GROQ.COM/OPENAI/V1/')).toBe('groq');
  });

  it('devuelve null si no coincide nada', () => {
    expect(brandForEndpoint('https://mi-proxy.casa/v1')).toBeNull();
    expect(brandForEndpoint('')).toBeNull();
  });
});

describe('detección de marca por modelo', () => {
  it('reconoce las familias por el nombre del modelo', () => {
    expect(brandForModel('claude-sonnet-4.5')).toBe('anthropic');
    expect(brandForModel('gpt-4.1-mini')).toBe('openai');
    expect(brandForModel('gemini-2.5-flash')).toBe('google');
    expect(brandForModel('meta-llama/Llama-3.3-70B-Instruct-Turbo')).toBe('meta');
    expect(brandForModel('llama3.1')).toBe('meta');
    expect(brandForModel('mistral-large-latest')).toBe('mistral');
    expect(brandForModel('deepseek-chat')).toBe('deepseek');
    expect(brandForModel('qwen-plus')).toBe('qwen');
    expect(brandForModel('grok-3')).toBe('xai');
    expect(brandForModel('kimi-k2-0711-preview')).toBe('moonshot');
    expect(brandForModel('glm-4-plus')).toBe('zhipu');
    expect(brandForModel('sonar')).toBe('perplexity');
    expect(brandForModel('mock')).toBe('mock');
  });

  it('no adivina con nombres desconocidos', () => {
    expect(brandForModel('')).toBeNull();
    expect(brandForModel('mi-modelo-finetruneado')).toBeNull();
  });

  it('el modelo manda sobre el endpoint: un Claude en OpenRouter se ve como Claude', () => {
    expect(detectAiBrand('https://openrouter.ai/api/v1', 'anthropic/claude-sonnet-4.5')).toBe(
      'anthropic',
    );
    // Y un modelo abierto sin familia reconocida vuelve al endpoint.
    expect(detectAiBrand('https://openrouter.ai/api/v1', 'usuario/mi-modelo')).toBe(
      'openrouter',
    );
    expect(detectAiBrand('http://127.0.0.1:11434/v1', 'llama3.1')).toBe('meta');
  });

  it('sin pista ninguna cae en proveedor propio', () => {
    expect(detectAiBrand('https://mi-proxy.casa/v1', 'mi-modelo')).toBe('custom');
  });
});

describe('etiquetas y sugerencias', () => {
  it('nombra el endpoint conocido y cae al host', () => {
    expect(endpointLabel('https://api.openai.com/v1')).toBe('OpenAI');
    expect(endpointLabel('http://127.0.0.1:11434/v1')).toBe('Ollama');
    expect(endpointLabel('https://mi-proxy.casa:8443/v1')).toBe('mi-proxy.casa:8443');
    expect(endpointLabel('')).toBe('sin endpoint');
  });

  it('sugiere los modelos del endpoint y siempre incluye el actual', () => {
    const list = suggestedModels('https://api.openai.com/v1', 'gpt-4o');
    expect(list[0]).toBe('gpt-4o');
    expect(list).toContain('gpt-4.1-mini');
    // Sin endpoint conocido igual respeta lo que ya había.
    expect(suggestedModels('https://mi-proxy.casa/v1', 'mi-modelo')).toEqual(['mi-modelo']);
    expect(suggestedModels('https://mi-proxy.casa/v1', '  ')).toEqual([]);
  });
});
