import { networkInterfaces } from 'node:os';

/** Whether the interface exists and has an address that is not a loopback one. */
export function interfaceUp(name: string): boolean {
  const addresses = networkInterfaces()[name] ?? [];
  return addresses.some((address) => !address.internal);
}
