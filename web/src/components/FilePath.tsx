export const FILE_PATH_CLASS = 'rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground';

const VARIANT_CLASS = {
  line: 'block w-fit min-w-0 max-w-full self-start truncate',
  inline: 'break-all box-decoration-clone',
};

export function FilePath({
  path,
  variant = 'inline',
}: {
  path: string;
  variant?: 'line' | 'inline';
}) {
  return (
    <code title={path} className={`${FILE_PATH_CLASS} ${VARIANT_CLASS[variant]}`}>
      {path}
    </code>
  );
}
