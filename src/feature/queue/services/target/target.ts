import { rejected } from '../../../../platform/errors/index.ts';
import { refExists, runGit } from '../../../../platform/git/index.ts';
import { checkDeliveryBranch, type DeliveryBranch } from '../../../runs/types/index.ts';
import { serverModeOn, type ConfigService } from '../../../swarm-config/services/index.ts';
import type { DeliveryMode } from '../../../swarm-config/types/index.ts';
import type { ItemPatch, QueueEditRequest, QueueItem } from '../../types/index.ts';

/** Checks the effective settings and local ref before accepting a target. */
export async function ensureDeliveryTarget(
  configs: ConfigService,
  repository: string,
  target: DeliveryBranch | null | undefined,
  auto: boolean | null | undefined,
  mode: DeliveryMode | null | undefined,
): Promise<void> {
  if (target == null) return;
  const delivery = configs.load(repository).delivery;
  checkDeliveryBranch(target, auto ?? delivery.auto, mode ?? delivery.mode, serverModeOn(configs));
  if ((await runGit(repository, ['check-ref-format', '--branch', target.name], { allowFailure: true })).code !== 0)
    throw rejected('deliveryBranch must contain a valid local branch name');
  const exists = await refExists(repository, `refs/heads/${target.name}`);
  if (target.strategy === 'existing' && !exists)
    throw rejected(`deliveryBranch \`${target.name}\` does not exist`);
  if (target.strategy === 'create' && exists)
    throw rejected(`deliveryBranch \`${target.name}\` already exists`);
}

export async function ensureEditedTarget(config: ConfigService, repository: string, item: QueueItem | undefined, patch: QueueEditRequest): Promise<void> {
  if (!item || item.run) return;
  await ensureDeliveryTarget(config, repository,
    patch.deliveryBranch === undefined ? item.deliveryBranch : patch.deliveryBranch,
    patch.autoDeliver === undefined ? item.autoDeliver : patch.autoDeliver,
    patch.deliveryMode === undefined ? item.deliveryMode : patch.deliveryMode);
}

export function itemPatch(params: QueueEditRequest, global: boolean): ItemPatch {
  const { pipeline, variant, provider, task, groups, title, autoDeliver, deliveryMode, deliveryBranch, position, postponed, inheritTags } = params;
  return { pipeline, variant, provider, task, groups, title, autoDeliver, deliveryMode, deliveryBranch, position: global ? undefined : position, postponed, inheritTags };
}
