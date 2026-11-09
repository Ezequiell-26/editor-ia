# PROVIDERS-AND-MCP — Olyvia 0.2.0

## Providers disponibles (reales, sin simulación)

| Tipo | Provider | Coste | Notas |
|---|---|---|---|
| Voz | Windows SAPI (`local-sapi-voice`) | 0 | Por escena, narración |
| Música | ffmpeg lavfi (`local-ambient-music`) | 0 | Ambient/cama generada |
| Imagen | titlecard ffmpeg (`local-ffmpeg-titlecard`) | 0 | `title:`/`card:` |
| Imagen | patrones lavfi (`local-pattern-generator`) | 0 | `pattern:`/`gradient:`/`texture:` |
| B-roll | Internet Archive | 0 | Con derechos verificables |
| Imagen remota | OpenAI-compatible `/images/generations` | BYOK | `gen:<prompt>`, keyring, https |
| Voz remota | OpenAI-compatible `/audio/speech` | BYOK | `remote:`/`remote:<voz>`, magic bytes, ≤64 MB |

## BYOK (Bring Your Own Key)

- Configuración en Ajustes → Proveedores (OpenAI-compatible: base URL + modelo).
- La clave se guarda en **Windows Credential Manager** (keyring), nunca en
  archivos de proyecto ni logs.
- Endpoints loopback (local) no requieren presupuesto; remotos exigen
  `maxCostCents > 0` en el plan.

## MCP

Servidor MCP interno de Olyvia. Tools relevantes para producción autónoma:

- `production_plan_from_brief` — brief estructurado → `ProductionPlan`
- `production_plan_from_text` — texto libre → plan (requiere chat BYOK)
- `production_create` / `production_start` / `production_pause` /
  `production_resume` / `production_cancel` / `production_advance` /
  `production_list` / `production_status`
- `studio_capabilities` — reporte real de providers disponibles

Flujo completo por MCP (sin UI):

```
production_plan_from_text("video de 30s sobre X para TikTok")
→ production_create(plan)
→ production_start(runId)   # driver backend, sin polling
→ production_status(runId)  # hasta deliver
```

## Pendiente

- Vídeo/música remotos BYOK (imagen y voz TTS ya implementados; no hay
  estándar OpenAI-compatible para vídeo/música — requiere endpoint concreto).
- `faster-whisper` para subtítulos por IA (no instalado).
