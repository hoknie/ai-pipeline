import { describe, expect, it } from 'vitest';

import { refusal, validateParams } from '../../../src/feature/integrations/types/index.ts';
import {
  SERVICE_REGISTRY_KIND,
  registryBase,
  serviceRegistryDescriptor,
} from '../../../src/feature/service-registry/types/index.ts';

describe('descriptor of the service-registry kind', () => {
  it('declares the address, the token and only the outbound direction', () => {
    expect(serviceRegistryDescriptor.kind).toBe(SERVICE_REGISTRY_KIND);
    expect(serviceRegistryDescriptor.params.map((p) => [p.name, p.required])).toEqual([
      ['url', true],
    ]);
    expect(serviceRegistryDescriptor.secrets).toEqual([{ slot: 'token', required: true }]);
    expect(serviceRegistryDescriptor.directions).toEqual(['outbound']);
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
