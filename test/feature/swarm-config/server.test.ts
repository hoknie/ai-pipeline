import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ConfigLoadError,
  type ConfigPaths,
  defaultWeb,
} from '../../../src/feature/swarm-config/types/index.ts';
import {
  configPaths,
  loadConfig,
  loadServerSettings,
} from '../../../src/feature/swarm-config/services/index.ts';
import { validateServerSection } from '../../../src/feature/swarm-config/services/sections/server.ts';

function temporaryPaths(): ConfigPaths {
  const root = mkdtempSync(join(tmpdir(), 'aip-server-'));
  return configPaths(join(root, 'repo'), join(root, 'xdg'), undefined);
}

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function paths(of: ConfigPaths): string[] {
  try {
    loadConfig(of);
    return [];
  } catch (error) {
    if (!(error instanceof ConfigLoadError)) throw error;
    const detail = error.detail;
    return detail.kind === 'invalid' ? detail.errors.map((e) => e.path) : [];
  }
}

describe('server settings', () => {
  it('default to off with the documented values', () => {
    expect(loadServerSettings(temporaryPaths())).toEqual({
      enabled: false,
      listen: '127.0.0.1:7341',
      publicUrl: null,
      trustedProxies: [],
      sessionTtl: '12h',
      tokenMaxTtl: '90d',
      sso: { oidc: null, saml: null },
    });
  });

  it('fill defaults around enabled and public_url', () => {
    const { server, errors } = validateServerSection(
      { enabled: true, public_url: 'https://aip.example.com' },
      defaultWeb(),
    );
    expect(errors).toEqual([]);
    expect(server).toMatchObject({
      enabled: true,
      listen: '127.0.0.1:7341',
      publicUrl: 'https://aip.example.com',
      sessionTtl: '12h',
      tokenMaxTtl: '90d',
    });
  });

  it('name the path of a wrong session_ttl and of other wrong fields', () => {
    const web = defaultWeb();
    expect(validateServerSection({ session_ttl: 'soon' }, web).errors.map((e) => e.path)).toEqual([
      'swarm.server.session_ttl',
    ]);
    expect(validateServerSection({ token_max_ttl: '12h' }, web).errors.map((e) => e.path)).toEqual([
      'swarm.server.token_max_ttl',
    ]);
    expect(validateServerSection({ listen: 'nowhere' }, web).errors.map((e) => e.path)).toEqual([
      'swarm.server.listen',
    ]);
    expect(
      validateServerSection({ public_url: 'ftp://x.example' }, web).errors.map((e) => e.path),
    ).toEqual(['swarm.server.public_url']);
    expect(
      validateServerSection({ public_url: 'https://x.example/aip' }, web).errors.map((e) => e.path),
    ).toEqual(['swarm.server.public_url']);
    expect(
      validateServerSection({ trusted_proxies: ['10.0.0.5', 'proxy'] }, web).errors.map(
        (e) => e.path,
      ),
    ).toEqual(['swarm.server.trusted_proxies[1]']);
    expect(validateServerSection({ color: 1 }, web).errors.map((e) => e.path)).toEqual([
      'swarm.server.color',
    ]);
  });

  it('require public_url when enabled', () => {
    expect(
      validateServerSection({ enabled: true }, defaultWeb()).errors.map((e) => e.path),
    ).toEqual(['swarm.server.public_url']);
  });

  it('reject web.auth none and web.autostart false in server mode', () => {
    const server = { enabled: true, public_url: 'https://aip.example.com' };
    const none = { ...defaultWeb(), auth: 'none' as const };
    expect(validateServerSection(server, none).errors.map((e) => e.path)).toEqual([
      'swarm.web.auth',
    ]);
    const off = { ...defaultWeb(), autostart: false };
    expect(validateServerSection(server, off).errors.map((e) => e.path)).toEqual([
      'swarm.web.autostart',
    ]);
  });

  it('report the web conflict from the whole configuration check', () => {
    const of = temporaryPaths();
    write(
      join(of.global.directory, 'settings.yaml'),
      'server: { enabled: true, public_url: "https://aip.example.com" }\nweb: { auth: none }\n',
    );
    expect(paths(of)).toEqual(['swarm.web.auth']);
  });

  it('are an error at the project level', () => {
    const of = temporaryPaths();
    write(join(of.global.directory, 'settings.yaml'), 'max: 2\n');
    write(join(of.project.directory, 'settings.yaml'), 'server: { enabled: true }\n');
    expect(paths(of)).toContain('swarm.server');
  });

  it('are read from the global file', () => {
    const of = temporaryPaths();
    write(
      join(of.global.directory, 'settings.yaml'),
      'server: { enabled: true, listen: "0.0.0.0:7341", public_url: "https://aip.example.com", trusted_proxies: [10.0.0.5], session_ttl: 2d }\n',
    );
    expect(loadServerSettings(of)).toMatchObject({
      enabled: true,
      listen: '0.0.0.0:7341',
      trustedProxies: ['10.0.0.5'],
      sessionTtl: '2d',
    });
  });

  describe('sso', () => {
    const web = defaultWeb();
    const oidc = {
      issuer: 'https://sso.example.com/realms/aip',
      client_id: 'aip',
      client_secret_env: 'AIP_OIDC_SECRET',
    };

    it('accept a provider and fill defaults', () => {
      const { server, errors } = validateServerSection({ sso: { oidc } }, web);
      expect(errors).toEqual([]);
      expect(server.sso.oidc).toEqual({
        issuer: 'https://sso.example.com/realms/aip',
        clientId: 'aip',
        clientSecretEnv: 'AIP_OIDC_SECRET',
        scopes: ['openid', 'email', 'profile'],
        label: 'SSO',
        claims: { email: 'email', name: 'name' },
        attributes: {},
        allowedDomains: [],
      });
    });

    it('read claims, attributes, label and domains', () => {
      const { server, errors } = validateServerSection(
        {
          sso: {
            oidc: {
              ...oidc,
              label: 'Keycloak',
              scopes: ['openid', 'groups'],
              claims: { email: 'mail' },
              attributes: { groups: 'groups', department: 'dept' },
              allowed_domains: ['Corp.com'],
            },
          },
        },
        web,
      );
      expect(errors).toEqual([]);
      expect(server.sso.oidc).toMatchObject({
        label: 'Keycloak',
        scopes: ['openid', 'groups'],
        claims: { email: 'mail', name: 'name' },
        attributes: { groups: 'groups', department: 'dept' },
        allowedDomains: ['corp.com'],
      });
    });

    it('reject client_secret with a hint', () => {
      const { errors } = validateServerSection(
        { sso: { oidc: { ...oidc, client_secret: 'x' } } },
        web,
      );
      expect(errors.map((e) => e.path)).toEqual(['swarm.server.sso.oidc.client_secret']);
      expect(errors[0]?.message).toContain('client_secret_env');
    });

    it('reject an unknown provider and unknown keys', () => {
      expect(validateServerSection({ sso: { ldap: {} } }, web).errors.map((e) => e.path)).toEqual([
        'swarm.server.sso.ldap',
      ]);
      expect(
        validateServerSection({ sso: { oidc: { ...oidc, color: 1 } } }, web).errors.map(
          (e) => e.path,
        ),
      ).toEqual(['swarm.server.sso.oidc.color']);
    });

    it('name the path of wrong or missing fields', () => {
      const paths = (value: unknown): string[] =>
        validateServerSection({ sso: { oidc: value } }, web).errors.map((e) => e.path);
      expect(paths({ ...oidc, issuer: 'nope' })).toEqual(['swarm.server.sso.oidc.issuer']);
      expect(paths({ ...oidc, client_secret_env: 'a b' })).toEqual([
        'swarm.server.sso.oidc.client_secret_env',
      ]);
      expect(paths({ ...oidc, allowed_domains: ['corp.com', 'x'] })).toEqual([
        'swarm.server.sso.oidc.allowed_domains[1]',
      ]);
      expect(paths({ issuer: oidc.issuer })).toEqual([
        'swarm.server.sso.oidc.client_id',
        'swarm.server.sso.oidc.client_secret_env',
      ]);
    });
  });
});
