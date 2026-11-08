import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../../shared/ui/forms/button.tsx';
import { Card } from '../../../shared/ui/layout/card.tsx';
import { ChainRuntimeItem } from './ChainRuntimeItem.tsx';
import type { useChainEditor } from './useChainEditor.ts';

export function ChainRuntimes({
  editor,
  disabled,
}: {
  editor: ReturnType<typeof useChainEditor>;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Card>
      <section aria-labelledby="chain-section-runtimes" className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="chain-section-runtimes" className="text-sm font-semibold">
            {t('chains.runtimesTitle')}
          </h3>
          <Button variant="outline" size="sm" disabled={disabled} onClick={editor.addItem}>
            <Plus />
            {t('chains.addRuntime')}
          </Button>
        </div>
        {editor.draft.runtimes.map((item, index) => (
          <ChainRuntimeItem
            key={index}
            index={index}
            item={item}
            total={editor.draft.runtimes.length}
            disabled={disabled}
            onChange={(updated) => editor.updateItem(index, updated)}
            onMoveUp={() => editor.moveItem(index, index - 1)}
            onMoveDown={() => editor.moveItem(index, index + 1)}
            onRemove={() => editor.removeItem(index)}
          />
        ))}
      </section>
    </Card>
  );
}
