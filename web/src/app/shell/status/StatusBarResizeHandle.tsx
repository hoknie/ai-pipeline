import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';

import {
  chosenAfterKey,
  keyDelta,
  STATUS_BAR_MIN_HEIGHT,
  clampStatusBarHeight,
  nextChosenHeight,
  statusBarMaxHeight,
} from './statusBarHeight.ts';

function endDrag(onPreview: (height: number | null) => void): void {
  document.body.classList.remove('select-none');
  onPreview(null);
}

/** The top edge of the open strip: drag it or use the arrow keys to change the strip's height. */
export function StatusBarResizeHandle({
  height,
  chosen,
  viewportHeight,
  onPreview,
  onCommit,
}: {
  height: number;
  /** The remembered height, which may be larger than the shown one in a shrunk window. */
  chosen: number;
  viewportHeight: number;
  /** The height while dragging, not yet remembered; null when the drag ends. */
  onPreview: (height: number | null) => void;
  onCommit: (height: number) => void;
}) {
  const { t } = useTranslation();
  const drag = useRef<{ startY: number; startHeight: number; last: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const max = statusBarMaxHeight(viewportHeight);
  const onPreviewRef = useRef(onPreview);
  onPreviewRef.current = onPreview;
  // Unmounting (the strip was collapsed) cancels a drag in progress without remembering it.
  useEffect(
    () => () => {
      if (drag.current === null) return;
      drag.current = null;
      endDrag(onPreviewRef.current);
    },
    [],
  );

  const finish = () => {
    const current = drag.current;
    if (current === null) return;
    drag.current = null;
    setDragging(false);
    endDrag(onPreview);
    onCommit(nextChosenHeight(chosen, current.last, viewportHeight));
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    drag.current = { startY: event.clientY, startHeight: height, last: height };
    setDragging(true);
    document.body.classList.add('select-none');
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (current === null) return;
    current.last = clampStatusBarHeight(
      current.startHeight + (current.startY - event.clientY),
      viewportHeight,
    );
    onPreview(current.last);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta = keyDelta(event.key);
    if (delta === 0) return;
    event.preventDefault();
    onCommit(chosenAfterKey(chosen, height, delta, viewportHeight));
  };

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={t('statusBar.resize')}
      aria-valuenow={height}
      aria-valuemin={Math.min(STATUS_BAR_MIN_HEIGHT, max)}
      aria-valuemax={max}
      tabIndex={0}
      data-dragging={dragging || undefined}
      className="absolute inset-x-0 -top-1 z-20 h-2 cursor-row-resize touch-none transition-colors hover:bg-primary/30 focus-visible:bg-primary/40 focus-visible:outline-none data-[dragging]:bg-primary/40"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onKeyDown={onKeyDown}
    />
  );
}
