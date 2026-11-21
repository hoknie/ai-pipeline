import { describe, expect, it } from 'vitest';

import { refusal, validateParams } from '../../../src/feature/integrations/types/index.ts';
import {
  SERVICE_REGISTRY_KIND,
  registryBase,
  serviceRegistryDescriptor,
} from '../../../src/feature/service-registry/types/index.ts';

describe('descriptor of the service-registry kind', () => {
  it('declares the address, the rules, the two secrets and both directions', () => {
    expect(serviceRegistryDescriptor.kind).toBe(SERVICE_REGISTRY_KIND);
    expect(serviceRegistryDescriptor.params.map((p) => [p.name, p.required])).toEqual([
      ['url', true],
      ['on_deployment_drift', false],
      ['on_link_check_failed', false],
      ['on_repo_sync_failed', false],
    ]);
    expect(serviceRegistryDescriptor.secrets).toEqual([
      { slot: 'token', required: true },
      { slot: 'webhook_secret', required: false },
    ]);
    expect(serviceRegistryDescriptor.directions).toEqual(['outbound', 'inbound']);
    expect(serviceRegistryDescriptor.operations).toEqual(['queue_task']);
  });

  it('takes a pipeline name for a rule and names the parameter of a bad one', () => {
    const url = 'https://r.example.com';
    expect(
      validateParams(serviceRegistryDescriptor, { url, on_deployment_drift: 'investigate' }),
    ).toEqual({ url, on_deployment_drift: 'investigate' });
    for (const bad of ['bad name', 'Upper', '1x', '', 'a'.repeat(33)]) {
      expect(() =>
        validateParams(serviceRegistryDescriptor, { url, on_repo_sync_failed: bad }),
      ).toThrow(refusal('invalid_params', 'on_repo_sync_failed').message);
    }
  });

  it.each([
    ['https://registry.example.com', 'https://registry.example.com'],
    ['https://registry.example.com/', 'https://registry.example.com'],
    ['http://localhost:8080', 'http://localhost:8080'],
    ['http://127.0.0.1:3000/', 'http://127.0.0.1:3000'],
    ['https://[::1]:8443', 'https://[::1]:8443'],
  ])('accepts %s', (url, base) => {
    expect(registryBase(url)).toBe(base);
    expect(validateParams(serviceRegistryDescriptor, { url })).toEqual({ url });
  });

  it.each([
    'ftp://registry.example.com',
    'https://user:pass@registry.example.com',
    'https://registry.example.com/api/mcp',
    'https://registry.example.com/?a=1',
    'https://registry.example.com/#frag',
    'https://registry.example.com?x',
    'registry.example.com',
    '',
    'https://',
    `https://${'a'.repeat(2048)}.example.com`,
  ])('refuses %s without a network call', (url) => {
    expect(registryBase(url)).toBeNull();
    expect(() => validateParams(serviceRegistryDescriptor, { url })).toThrow(
      refusal('invalid_params', 'url').message,
    );
  });

  it('requires the url and refuses other parameters', () => {
    expect(() => validateParams(serviceRegistryDescriptor, {})).toThrow();
    expect(() =>
      validateParams(serviceRegistryDescriptor, { url: 'https://r.example.com', extra: 'x' }),
    ).toThrow();
  });
});
