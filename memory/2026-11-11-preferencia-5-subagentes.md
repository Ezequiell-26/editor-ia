# Preferencia: usar ~5 subagentes por pedido

**Fecha**: 2026-11-11 (petición explícita del usuario en sesión de pasadas de arquitectura)

## Regla

Cuando el usuario pida una tarea ("hacé X", "seguí", mejoras, auditorías), despachar
**~5 subagentes en paralelo** (`run_subagent` con `is_background=true`) en vez de
trabajar todo en el hilo principal, siempre que la tarea se pueda descomponer.

## Cómo aplicarlo

- Descomponer el pedido en 4-6 frentes **disjuntos** (sin dos subagentes escribiendo
  los mismos archivos) y lanzarlos en paralelo.
- Perfiles según el frente: `subagent_explore`/`analista-datos` (solo lectura),
  `backend-engineer`/`frontend-engineer`/`qa-engineer`/`rust-media-engineer`
  (escritura), `auditor-*`/`evaluador-app`/`detector-deuda` (auditorías).
- El hilo principal actúa como coordinador: define el alcance de cada subagente,
  verifica sus resultados (`read_subagent`) y consolida.
- **Excepción honesta**: para tareas triviales o de un solo archivo, 5 subagentes
  es desperdicio — el usuario lo sabe; aplicar criterio. Reportar cuántos se usaron.

## Contexto

- Pedido textual: "quiero tambien que uses multiples agentes cuando te pida algo
  que uses unos 5 subagentes siempre".
- Este proyecto (`editor-ia-architecture`) tiene ~60 subagentes de dominio propios
  en `.devin/agents/` además de los perfiles built-in.
