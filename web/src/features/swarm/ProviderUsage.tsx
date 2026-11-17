import { useTranslation } from 'react-i18next';

import { isUnused, type ProviderUsage } from './types/usage.ts';
import type { SwarmTarget } from './types/tabs.ts';

function UsageLink({
  label,
  target,
  hrefOf,
  onNavigate,
}: {
  label: string;
  target: SwarmTarget;
  hrefOf: (target: SwarmTarget) => string;
  onNavigate: (target: SwarmTarget) => void;
}) {
  return (
    <a
      className="underline"
      href={hrefOf(target)}
      onClick={(event) => {
        event.preventDefault();
        onNavigate(target);
      }}
    >
      {label}
    </a>
  );
}

/** The block «Where it is used»: chains, specialists and pipelines that end up running a provider. */
export function ProviderUsageBlock({
  usage,
  hrefOf,
  onNavigate,
}: {
  usage: ProviderUsage;
  hrefOf: (target: SwarmTarget) => string;
  onNavigate: (target: SwarmTarget) => void;
}) {
  const { t } = useTranslation();
  const link = { hrefOf, onNavigate };
  return (
    <section aria-label={t('providers.usage.title')} className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">{t('providers.usage.title')}</h3>
      {isUnused(usage) ? (
        <p className="text-sm text-muted-foreground">
          {t('providers.usage.none')}{' '}
          <UsageLink
            {...link}
            label={t('swarm.tabs.chains')}
            target={{ tab: 'chains', entry: null }}
          />
        </p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {usage.chains.map((chain) => (
            <li key={`chain:${chain.slug}`}>
              <UsageLink
                {...link}
                label={t('providers.usage.chain', {
                  name: chain.name,
                  item: chain.items.join(', '),
                })}
                target={{ tab: 'chains', entry: chain.slug }}
              />
            </li>
          ))}
          {usage.specialists.map((specialist) => (
            <li key={`specialist:${specialist.slug}`}>
              <UsageLink
                {...link}
                label={t('providers.usage.specialist', { name: specialist.name })}
                target={{ tab: 'specialists', entry: specialist.slug }}
              />
            </li>
          ))}
          {usage.pipelines.map((pipeline) => (
            <li key={`pipeline:${pipeline.id}`}>
              <UsageLink
                {...link}
                label={t('providers.usage.pipeline', {
                  name: pipeline.name,
                  step: [...pipeline.steps, ...(pipeline.split ? ['split'] : [])].join(', '),
                })}
                target={{ tab: 'pipelines', entry: pipeline.id }}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
