import { describe, expect, it } from 'vitest';

import { Wiring, declarePorts } from '../../src/app/wiring.ts';

describe('wiring of the ports', () => {
  it('refuses to start with a port left empty and names it', () => {
    const wiring = new Wiring();
    const set = wiring.port<{ ping(): string }>('a.set');
    wiring.port<{ ping(): string }>('b.empty');
    set.set({ ping: () => 'pong' });
    expect(() => wiring.check()).toThrow('ports are not wired: b.empty');
  });

  it('calls the implementation set after the port was handed out', () => {
    const wiring = new Wiring();
    const late = wiring.port<{ ping(): string }>('a');
    const { port } = late;
    expect(() => port.ping()).toThrow('port a is not wired');
    late.set({ ping: () => 'pong' });
    expect(port.ping()).toBe('pong');
    wiring.check();
  });

  it('declares every port of the application once', () => {
    const { wiring, ports } = declarePorts();
    expect(() => wiring.check()).toThrow('ports are not wired');
    for (const port of Object.values(ports)) port.set({} as never);
    expect(() => wiring.check()).not.toThrow();
  });
});
