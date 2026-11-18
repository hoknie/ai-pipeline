/** A daemon on another machine: the address of its panel and a personal token. */
export interface RemoteDaemon {
  url: string;
  token: string;
}

/** Where the daemon is: the path of its socket, or a server reached over HTTP. */
export type DaemonAddress = string | RemoteDaemon;

export function isRemote(address: DaemonAddress): address is RemoteDaemon {
  return typeof address !== 'string';
}

/** The text of an address for messages. */
export function describeAddress(address: DaemonAddress): string {
  return isRemote(address) ? address.url : address;
}
