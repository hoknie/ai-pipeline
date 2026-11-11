/** The environment of an agent with `network.proxy`; `runtimes.<runtime>.env` still wins over it. */
export function withProxy(environment: NodeJS.ProcessEnv, proxy: string | null): NodeJS.ProcessEnv {
  return proxy === null ? environment : { ...environment, HTTPS_PROXY: proxy, HTTP_PROXY: proxy };
}
