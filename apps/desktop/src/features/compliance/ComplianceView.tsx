import { useEffect, useMemo, useRef, useState } from 'react';
import type { ViewId } from '../../app/navigation';
import { Icon, type IconName } from '../../components/Icon';
import { ViewToolbar } from '../../components/ViewToolbar';
import { useProjectStore } from '../../state/project-store';
import {
  BUILTIN_RULE_PACKS,
  auditProjectForPlatform,
  mergeRulePacks,
  parseRulesDocument,
  type PlatformRulePack,
  type RuleFinding,
  type RuleSeverity,
} from '../../state/platform-rules';

const CACHE_KEY = 'editor-ia.platform-rules.remote.v1';
const CHECK_KEY = 'editor-ia.platform-rules.last-check.v1';
const DAY_MS = 24 * 60 * 60 * 1000;

function readCache(): PlatformRulePack[] {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return [];
    const document = parseRulesDocument(JSON.parse(raw));
    return document ? [...document.packs] : [];
  } catch {
    return [];
  }
}

function readLastCheck(): number {
  try {
    const raw = Number(window.localStorage.getItem(CHECK_KEY));
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
  } catch {
    return 0;
  }
}

function findingIcon(severity: RuleSeverity): IconName {
  if (severity === 'block') return 'close';
  if (severity === 'warn') return 'alert';
  if (severity === 'ok') return 'check';
  return 'info';
}

export function ComplianceView({ onNavigate }: { readonly onNavigate: (id: ViewId) => void }) {
  const store = useProjectStore();
  const project = store.state.project;
  const [packId, setPackId] = useState('youtube');
  const [remotePacks, setRemotePacks] = useState<PlatformRulePack[]>(readCache);
  const [lastChecked, setLastChecked] = useState<number>(readLastCheck);
  const [checking, setChecking] = useState(false);
  const [updateNote, setUpdateNote] = useState<string | null>(null);
  const autoChecked = useRef(false);

  const packs = useMemo(
    () => mergeRulePacks(BUILTIN_RULE_PACKS, remotePacks),
    [remotePacks],
  );
  const pack = packs.find((item) => item.id === packId) ?? packs[0] ?? BUILTIN_RULE_PACKS[0]!;
  const findings = useMemo(
    () => (project ? auditProjectForPlatform(project, pack) : []),
    [project, pack],
  );
  const problems = findings.filter(
    (finding) => finding.severity === 'warn' || finding.severity === 'block',
  ).length;
  const lastCheckedLabel = lastChecked
    ? new Date(lastChecked).toLocaleString('es-AR', {
        dateStyle: 'short',
        timeStyle: 'short',
      })
    : 'nunca';

  async function refresh(manual: boolean): Promise<void> {
    if (checking) return;
    setChecking(true);
    if (manual) setUpdateNote(null);
    try {
      const payload = await store.service.fetchPlatformRules();
      const document = parseRulesDocument(payload);
      if (!document || document.packs.length === 0) {
        throw new Error('El documento remoto no tiene reglas válidas.');
      }
      try {
        window.localStorage.setItem(CACHE_KEY, JSON.stringify(document));
        window.localStorage.setItem(CHECK_KEY, String(Date.now()));
      } catch {
        // The remote rules still apply to this session.
      }
      setRemotePacks([...document.packs]);
      setLastChecked(Date.now());
      setUpdateNote(
        `Reglas actualizadas${document.generatedAt ? ` · ${document.generatedAt}` : ''}.`,
      );
      if (manual) store.setNotice('Reglas de plataformas actualizadas.');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'no se pudieron actualizar las reglas';
      setUpdateNote(`Sin actualización remota: ${message} Se usan las reglas locales.`);
      if (manual) store.setNotice(`No se pudieron actualizar las reglas: ${message}`);
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    if (autoChecked.current) return;
    autoChecked.current = true;
    if (Date.now() - readLastCheck() > DAY_MS) {
      void refresh(false);
    }
    // Sólo una comprobación automática al abrir la vista.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openSource(url: string): void {
    void store.service.openExternalUrl(url).catch(() => {
      store.setNotice('No se pudo abrir la fuente en el navegador.');
    });
  }

  const affected = (finding: RuleFinding): string => finding.severity;

  return (
    <section className="view compliance-view">
      <ViewToolbar
        label="Cumplimiento"
        actions={
          <>
            <button
              type="button"
              className="icon-text ghost small"
              aria-label="Revisar publicación"
              title="Abrir Producción"
              onClick={() => onNavigate('production')}
            >
              <Icon name="production" size={14} />
              <span>Producción</span>
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Actualizar reglas de plataformas"
              title={`Actualizar reglas · última comprobación: ${lastCheckedLabel}`}
              disabled={checking || !store.service.available}
              onClick={() => void refresh(true)}
            >
              <Icon name="refresh" size={15} />
            </button>
          </>
        }
      >
        <label className="field inline compliance-platform">
          <span>Red social</span>
          <select
            value={pack.id}
            aria-label="Red social"
            onChange={(event) => setPackId(event.target.value)}
          >
            {packs.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <span className="view-count">reglas v{pack.version}</span>
      </ViewToolbar>

      <div className="compliance-layout">
        <article className="card compliance-audit">
          <div className="production-card-head">
            <div>
              <p className="eyebrow">Auditoría de preflight</p>
              <h3>
                {project ? project.name : 'Sin proyecto abierto'} · {pack.label}
              </h3>
            </div>
            <span className={`status-pill ${problems > 0 ? 'dirty' : 'saved'}`}>
              <span
                className={`status-pill-dot phase-${problems > 0 ? 'dirty' : 'saved'}`}
                aria-hidden="true"
              />
              {problems > 0 ? `${problems} aviso(s)` : 'Sin avisos'}
            </span>
          </div>

          {updateNote ? <p className="fine-print">{updateNote}</p> : null}

          {!project ? (
            <p className="empty-state">
              Abrí un proyecto para auditar duración, formato, derechos, IA y subtítulos antes de
              exportar.
            </p>
          ) : (
            <ul className="compliance-findings">
              {findings.map((finding) => (
                <li key={finding.id} className={`severity-${affected(finding)}`}>
                  <Icon name={findingIcon(finding.severity)} size={16} />
                  <div>
                    <strong>{finding.title}</strong>
                    <p>{finding.detail}</p>
                    {finding.source ? (
                      <button
                        type="button"
                        className="link-button icon-text"
                        onClick={() => openSource(finding.source!.url)}
                      >
                        <Icon name="external" size={11} />
                        <span>{finding.source.label}</span>
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <p className="fine-print">
            Es una ayuda de preflight, no una garantía. Cada plataforma cambia sus reglas y toma
            la decisión final. Las reglas locales se actualizan desde el documento público cuando
            está disponible.
          </p>
        </article>

        <aside className="compliance-side">
          <article className="card">
            <p className="eyebrow">Monetización</p>
            <ul className="compliance-rule-list">
              {pack.monetization.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
          </article>

          <article className="card">
            <p className="eyebrow">Riesgos de strike</p>
            <ul className="compliance-rule-list">
              {pack.strikeRisks.map((risk) => (
                <li key={risk}>{risk}</li>
              ))}
            </ul>
          </article>

          <article className="card">
            <p className="eyebrow">Fuentes · {pack.updatedAt || 'sin fecha'}</p>
            <ul className="compliance-sources">
              {pack.sources.map((source) => (
                <li key={source.url}>
                  <button
                    type="button"
                    className="link-button icon-text"
                    onClick={() => openSource(source.url)}
                  >
                    <Icon name="external" size={12} />
                    <span>{source.label}</span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="fine-print">
              Última comprobación remota: {lastCheckedLabel}. La app intenta actualizar una vez por
              día; si no hay red o el documento público no está disponible, conserva estas reglas
              locales y lo declara.
            </p>
          </article>
        </aside>
      </div>
    </section>
  );
}
