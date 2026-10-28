/**
 * Ayuda contextual compacta: reemplaza bloques de texto por un signo de
 * interrogación con tooltip nativo de la app.
 */
export function InfoTip({
  label,
  text,
  className,
}: {
  readonly label: string;
  readonly text: string;
  readonly className?: string;
}) {
  return (
    <span
      className={`info-tip${className ? ` ${className}` : ''}`}
      role="note"
      tabIndex={0}
      aria-label={`${label}: ${text}`}
      data-tooltip={text}
    >
      ?
    </span>
  );
}
