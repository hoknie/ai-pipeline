# Sign-in through SAML 2.0

In [server mode](server.md) people can also sign in through a corporate SAML 2.0 provider (ADFS, Okta, Microsoft Entra ID, Shibboleth). The login page then has a «Sign in with <label>» button; with [OpenID Connect](sso.md) configured too, it shows both buttons.

## `server.sso.saml`

```yaml
server:
  enabled: true
  public_url: https://aip.example.com
  sso:
    saml:
      idp_metadata: https://adfs.corp.com/FederationMetadata/2007-06/FederationMetadata.xml
      key_file: /etc/aip/saml.key
      cert_file: /etc/aip/saml.crt
      label: ADFS
      claims: { email: "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress" }
      attributes: { groups: "http://schemas.microsoft.com/ws/2008/06/identity/claims/groups" }
      trust_email: false
      allowed_domains: [corp.com]
```

| Field | Default | Meaning |
|---|---|---|
| `idp_metadata` | required | The metadata of the provider: an `http(s)` URL or the path of a file |
| `key_file`, `cert_file` | required | The private key and the certificate (PEM) the service signs its requests with. The key is never written in `settings.yaml` |
| `entity_id` | `<public_url>/auth/saml/metadata` | The entityID of the service |
| `label` | `SAML` | The caption of the button |
| `claims` | `email`: the NameID, `name`: none | The names of the attributes the email and the name are read from |
| `attributes` | none | User attribute → SAML attribute name: `attributes: { groups: <name> }` gives the user the attribute `groups` with every value of the SAML attribute |
| `trust_email` | `false` | Allows a sign-in to join a local account of the same email (see below) |
| `allowed_domains` | none | Only emails of these domains may sign in |

A missing or unreadable file is a validation error naming the field. A change takes effect after the daemon restarts.

Make the key and the certificate with `openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=aip" -keyout saml.key -out saml.crt`. The certificate is published in the metadata of the service.

## At the provider

Give the administrator of the provider the metadata of the service, open without a sign-in:

```
<public_url>/auth/saml/metadata
```

It holds the entityID, the signing certificate and the address that receives the answer of the provider (HTTP-POST binding): `<public_url>/auth/saml/acs`. Sign-in starts at `aip`; the provider sends the browser back to that address with a signed response.

| Provider | Notes |
|---|---|
| ADFS | Add a relying party trust from the metadata URL; claim rules: send the e-mail address and the groups («Token-Groups - Qualified by Domain», or «Token-Groups as SAM Account Name») as claims; use the claim URIs as `claims.email` and `attributes` |
| Okta | A «SAML 2.0» app: single sign-on URL `<public_url>/auth/saml/acs`, audience URI the entityID, name ID format `Persistent` or `EmailAddress`; add «Group Attribute Statements» with a filter for the groups you need, and use their attribute name in `attributes` |
| Microsoft Entra ID | An enterprise application with «SAML-based sign-on»: identifier the entityID, reply URL `<public_url>/auth/saml/acs`; for groups add a group claim in «Attributes & Claims» and use its claim URI (`http://schemas.microsoft.com/ws/2008/06/identity/claims/groups`) in `attributes` |

## Users

- A user is recognized by the entityID of the provider and the NameID, not by the email: prefer the `persistent` NameID format. When the email changes at the provider, the next sign-in updates the same account.
- The first sign-in creates the user with the source `saml`. The email, the name and the attributes are replaced with the provider's values at every sign-in; attributes of such a user cannot be changed with `aip server users set`.
- SAML has no «email verified» flag, so a sign-in joins a local account of the same email only with `trust_email: true`; otherwise it is refused and the account stays as it was. Turn it on only when the provider owns the emails of your domain.
- `allowed_domains` is checked at every sign-in; a refused person is not created. A disabled user cannot sign in.
- Users of OpenID Connect and of SAML are different accounts; the same email cannot belong to two of them.

## What is checked

The XML signature of the response or of the assertion (with the certificates of the provider's metadata), the audience (the entityID), the destination (the ACS address), `InResponseTo` (the request that the sign-in started), and the validity period (60 seconds of clock drift are tolerated).

An assertion is accepted once: sending it again is refused. Any failed check ends the sign-in on a page with the reason and creates no session.

Only sign-in that starts at `aip` works: starting from the portal of the provider (IdP-initiated), single logout and encrypted assertions are not supported.

## The metadata of the provider

A URL is downloaded at the start and once a day; the last good copy is kept in the state directory, so the daemon starts when the provider is down. After the provider rotates its certificate, the next download takes it (restart the daemon to take it at once). A file is read at the start.

The daemon keeps running when the provider is down: the log has the reason, the button reports that the provider is unavailable, and the next click tries again. Sign-in by a login link works either way.
