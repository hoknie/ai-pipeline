# Sign-in through OpenID Connect

In [server mode](server.md) people can sign in through a corporate OpenID Connect provider (Keycloak, Okta, Microsoft Entra ID, Google). The login page then has a «Sign in with <label>» button next to the login links.

## `server.sso.oidc`

```yaml
server:
  enabled: true
  public_url: https://aip.example.com
  sso:
    oidc:
      issuer: https://sso.example.com/realms/aip
      client_id: aip
      client_secret_env: AIP_OIDC_SECRET
      label: Keycloak
      scopes: [openid, email, profile, groups]
      claims: { email: email, name: name }
      attributes: { groups: groups, department: dept }
      allowed_domains: [corp.com]
```

| Field | Default | Meaning |
|---|---|---|
| `issuer` | required | The issuer URL of the provider; `<issuer>/.well-known/openid-configuration` must answer |
| `client_id` | required | The client registered at the provider |
| `client_secret_env` | required | The name of an environment variable of the **daemon** that holds the client secret. The secret itself is never written in `settings.yaml`; `client_secret` is a validation error |
| `scopes` | `[openid, email, profile]` | The scopes requested |
| `label` | `SSO` | The caption of the button |
| `claims` | `email`, `name` | The claims the email and the name are read from |
| `attributes` | none | Attribute name → claim name: `attributes: { groups: groups }` gives the user the attribute `groups` from the claim `groups` |
| `allowed_domains` | none | Only emails of these domains may sign in |

An unknown key under `server.sso` is a validation error. A change takes effect after the daemon restarts.

## At the provider

Register a confidential client with the authorization code flow and this redirect address:

```
<public_url>/auth/oidc/callback
```

For example `https://aip.example.com/auth/oidc/callback`. Put the client secret in the environment of the daemon, for example `Environment=AIP_OIDC_SECRET=...` in the systemd unit.

| Provider | `issuer` | Notes |
|---|---|---|
| Keycloak | `https://<host>/realms/<realm>` | Client authentication on; add a «Group Membership» mapper with the claim name `groups` and «Add to ID token» on |
| Okta | `https://<org>.okta.com` or `https://<org>.okta.com/oauth2/default` | A «Web» application; add a `groups` claim to the ID token with a filter on the groups you need |
| Microsoft Entra ID | `https://login.microsoftonline.com/<tenant-id>/v2.0` | A «Web» platform with the redirect address above; add the optional claim `groups` (token configuration) for groups; the `email` claim must be filled for every user |
| Google | `https://accounts.google.com` | An OAuth client of the «Web application» type; no groups, so restrict people with `allowed_domains` |

## Users

- A user is recognized by the pair issuer and subject (`sub`), not by the email. When the email changes at the provider, the next sign-in updates the same account and the runs keep their author.
- The first sign-in creates the user with the source `oidc`. The email, the name and the attributes are replaced with the provider's values at every sign-in, so the rights follow the groups of the directory from the next sign-in on (and no later than `session_ttl`). Attributes of such a user cannot be changed with `aip server users set`.
- If a local user (made with a login link) has the same email, the sign-in joins that account only when the provider confirmed the email (`email_verified`); otherwise it is refused and the account stays as it was. A joined account takes its attributes from the provider, so check that an administrator keeps the claim of the role before the first sign-in: `attributes: { role: roles }`.
- `allowed_domains` is checked at every sign-in; a refused person is not created. The check trusts the email claim as the provider sends it: where users set their own email (a multi-tenant Entra ID app), restrict the tenant at the provider too.
- A disabled user cannot sign in. `aip server users disable` stops the sessions and tokens as usual.

The id token is checked for its signature, expiry (60 seconds of clock drift are tolerated), issuer, audience and nonce. Any failed check ends the sign-in on a page with the reason and creates no session.

## When the provider is down

The daemon keeps running. Without the variable named by `client_secret_env` the log says so and the login page reports that SSO is not configured. When the provider does not answer, the log gets the reason, the button reports that the provider is unavailable, and the next click tries again. Sign-in by a login link works either way.
