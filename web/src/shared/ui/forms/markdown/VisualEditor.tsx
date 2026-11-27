import type { RefObject } from 'react';
import type { EditorView } from 'prosemirror-view';
import { cn } from '../../../lib/browser/cn.ts';
import { EditableBlock } from './EditableBlock.tsx';

function activeHandlers(active: RefObject<EditorView | null>) {
  return {
    onActive: (view: EditorView) => {
      active.current = view;
    },
    onDestroy: (view: EditorView) => {
      if (active.current === view) active.current = null;
    },
  };
}

function Placeholder({ text }: { text?: string }) {
  return (
    <span aria-hidden className="pointer-events-none absolute text-muted-foreground">
      {text}
    </span>
  );
}

export function VisualEditor({
  visual,
  active,
  id,
  label,
  value,
  onChange,
  placeholder,
  disabled,
  grow,
  height,
  onLink,
}: {
  visual: RefObject<HTMLDivElement | null>;
  active: RefObject<EditorView | null>;
  id?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  grow: boolean;
  height: string;
  onLink: (view: EditorView) => void;
}) {
  const empty = value.trim() === '';
  return (
    <div
      ref={visual}
      className={cn(
        'relative rounded-md border border-input bg-card px-2.5 py-1.5 text-sm',
        grow && 'flex-1',
      )}
      style={{ minHeight: height }}
    >
      {empty ? <Placeholder text={placeholder} /> : null}
      <EditableBlock
        raw={value}
        id={id}
        label={label}
        placeholder={placeholder}
        disabled={disabled}
        {...activeHandlers(active)}
        onChange={onChange}
        onLink={onLink}
      />
    </div>
  );
}
