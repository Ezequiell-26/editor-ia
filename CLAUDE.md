# Instrucciones de Claude para Editor IA / Olyvia

## Activación por instrucciones breves

El proyecto principal del usuario está en `D:\Users\ofici\QODER-WORK\editor-ia`.
Cuando el usuario diga frases como **“seguí”, “sigue”, “continúa”, “arreglá la app”, “mejorá la app”, “seguí mejorándola”** o expresiones equivalentes, interpreta que solicita continuar el trabajo técnico en este repositorio. No preguntes qué tarea debe elegir y no respondas solamente con un plan: inspecciona el estado y empieza la siguiente mejora concreta. Si el contexto activo identifica claramente otro proyecto, respeta ese contexto.

## Procedimiento obligatorio al retomar

1. Verifica que Desktop Commander y las herramientas que realmente necesites estén disponibles. Si falta acceso al proyecto, reporta el fallo real; no copies el repositorio a otra ubicación ni declares acceso sin probarlo.
2. Lee estas instrucciones y revisa `README.md`, `docs/IMPROVEMENT-QUEUE.md`, los archivos recientes de `memory/` y el estado de `.editoria-loop/LEDGER.json` según corresponda.
3. Ejecuta `git status --short --branch` y revisa diffs de las áreas que piensas tocar. Esta rama puede tener mucho trabajo no confirmado: se considera trabajo del usuario y debe preservarse.
4. Elige el siguiente cambio por impacto real, riesgo, dependencias y evidencia. Prioriza bugs reproducibles, regresiones, funciones incompletas y calidad/estabilidad del flujo profesional de edición. No repitas características que ya están implementadas.
5. Implementa el cambio, no te limites a sugerirlo. Usa pruebas primero cuando sea práctico, cambios pequeños y verificación real. Corre las pruebas más específicas durante el desarrollo y `npm run verify` u otra verificación amplia cuando el coste y el estado del entorno lo permitan.
6. Repara los fallos causados por el cambio. Si la suite falla por una causa previa o ajena, identifica la evidencia y no la etiquetes como verde.
7. Registra lo realizado, los archivos tocados, los comandos/resultados de prueba y el próximo paso en la cola o memoria del proyecto. No declares una tarea `done` sin la evidencia que exige el mecanismo existente.
8. Devuelve un informe corto con cambio, pruebas y bloqueo real si lo hay. Si sigue habiendo una siguiente mejora segura y queda margen en la sesión, continúa con el siguiente ciclo en vez de detenerte después de un simple diagnóstico.

## Protocolo del loop existente

- Lee `scripts/loop-preflight.mjs` y `scripts/loop-record.mjs` antes de usar el loop. El preflight/ledger puede imponer límites de RAM, bloqueo o fallos consecutivos.
- No falsifiques el ledger ni evadas bloqueos. No dupliques una pasada activa.
- Si la cola del ledger está cerrada, busca una brecha demostrable en la cola de mejora y el código; define criterio de aceptación antes de implementar.
- Mantén una iteración acotada y verificable. Si no se puede validar una mejora, deja el estado honesto y anota exactamente lo que falta.

## Límites de seguridad y preservación

- Nunca uses `git reset --hard`, `git clean`, borrado masivo, ni reviertas cambios preexistentes para “limpiar” el árbol.
- No sobrescribas archivos del usuario sin inspeccionarlos. No borres los archivos temporales existentes por mera limpieza; limita la limpieza a artefactos que crees en esta tarea y que hayas identificado.
- No hagas `git commit`, `git push`, merges, publicaciones, despliegues ni operaciones de cuenta sin autorización explícita.
- No instales/reemplaces la aplicación que está en uso, no cierres procesos de usuario, no cambies firmas/licencias comerciales ni habilites pagos sin autorización.
- No imprimas ni copies secretos, tokens, cookies, credenciales o claves API. No inventes datos, capacidades, pruebas pasadas o resultados.
- Puedes leer, editar código, ejecutar pruebas locales y corregir errores dentro del repositorio sin pedir permiso por cada paso. Pregunta solamente cuando falte una decisión irreversible, una credencial/permiso externo o un dato imprescindible que no pueda inferirse de manera segura.

## Criterio de calidad

La meta es un editor de video profesional y fiable, no una lista de funciones ficticia. Prioriza integración funcional de extremo a extremo, UX coherente, accesibilidad, estabilidad, rendimiento en el PC real, seguridad, licencias de terceros y pruebas. No declares el proyecto “100 % terminado” mientras queden brechas conocidas; documenta límites y siguiente paso.
