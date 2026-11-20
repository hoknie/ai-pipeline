import i18next from 'i18next';
import { describe, expect, it } from 'vitest';

import {
  checkCodeText,
  defaultValueLabel,
  kindTitle,
  paramHint,
  paramLabel,
  secretLabel,
  valueLabel,
} from '../src/features/integrations/kindLabels.ts';
import '../src/shared/i18n/index.ts';

const en = i18next.getFixedT('en');
const ru = i18next.getFixedT('ru');
const zh = i18next.getFixedT('zh');

describe('the labels of the integration kinds', () => {
  it('translates a built-in kind, its parameters, values and secrets', () => {
    expect(kindTitle(ru, 'service-registry', 'Service registry')).toBe('Реестр сервисов');
    expect(paramLabel(ru, 'telegram', 'allowed_users')).toBe('Кто может отвечать');
    expect(paramHint(ru, 'telegram', 'chat_id')).toContain('/id');
    expect(paramHint(en, 'telegram', 'chat_id')).toContain('/id');
    expect(paramHint(zh, 'telegram', 'allowed_users')).toContain('/id');
    expect(paramHint(ru, 'telegram', 'language')).toContain('кнопки');
    expect(valueLabel(zh, 'telegram', 'language', 'ru')).toBe('Русский');
    expect(valueLabel(en, 'slack', 'language', 'en')).toBe('English');
    expect(defaultValueLabel(ru, 'telegram', 'language')).toBe('По умолчанию (English)');
    expect(secretLabel(en, 'slack', 'app_token')).toBe('App token (Socket Mode)');
  });

  it('falls back to the technical name for an unknown kind or parameter', () => {
    expect(kindTitle(ru, 'matrix', 'Matrix bridge')).toBe('Matrix bridge');
    expect(kindTitle(ru, 'matrix')).toBe('matrix');
    expect(paramLabel(ru, 'matrix', 'room')).toBe('room');
    expect(paramLabel(ru, 'telegram', 'room')).toBe('room');
    expect(paramHint(ru, 'matrix', 'room')).toBe('');
    expect(valueLabel(ru, 'matrix', 'room', 'x')).toBe('x');
    expect(defaultValueLabel(ru, 'matrix', 'room')).toBeNull();
    expect(secretLabel(ru, 'matrix', 'key')).toBe('key');
  });

  it('translates the code of a check and leaves an unknown code as it is', () => {
    expect(checkCodeText(ru, 'unauthorized')).toBe('Registry отклонил токен');
    expect(checkCodeText(en, 'timeout')).toBe('Registry did not answer in time');
    expect(checkCodeText(ru, 'weird')).toBe('weird');
  });
});
