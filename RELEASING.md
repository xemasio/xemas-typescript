# Releasing

Releases publish through **trusted publishing (OIDC)** — `.github/workflows/release.yml`. There is
no `NPM_TOKEN` in this repository and none should ever be added.

npm matches the GitHub OIDC claim against this identity, so the workflow *is* the credential:

| | |
|---|---|
| GitHub owner | `xemasio` |
| Repository | `xemas-typescript` |
| Workflow filename | `release.yml` |
| Environment | `release` (required reviewer) |

Two things break publishing if changed carelessly:

- **Renaming `release.yml`.** The filename is part of the identity. Renaming it breaks publishing
  until the npm publisher record is updated to match.
- **Confusing the namespaces.** The npm *scope* is `@xemas-security`; the *GitHub owner* is
  `xemasio`. The publisher record needs the GitHub one. This exact mistake was made once on PyPI
  (`pbk714290` entered instead of `xemasio`) and would have failed at publish time.

## Normal release

1. Bump `version` in `package.json`.
2. Merge to `main`.
3. Tag and push: `git tag v0.1.1 && git push origin v0.1.1`
4. GitHub → **Releases → Draft a new release** → select the tag → publish.
5. The `release` environment requests approval. Review the job, then approve.
6. Verify from a clean directory — *not* from the npm web page:

   ```bash
   mkdir /tmp/sdk-check && cd /tmp/sdk-check && npm init -y
   npm install @xemas-security/sdk
   node -e "const {Xemas}=require('@xemas-security/sdk'); console.log(typeof Xemas)"
   ```

The workflow fails if the tag and `package.json` version disagree. npm versions are immutable once
published, so that check exists because upload is the last moment the mismatch is cheap to fix.

## The one-time bootstrap exception (2026-08-16)

**This is a recorded exception, not a precedent. Do not repeat it for future releases.**

npm has no equivalent of PyPI's "pending publisher": a trusted publisher can only be configured on
a package that **already exists**, and trusted publishing is configured at
`npmjs.com/package/<name>/access`, which 404s until the first publish. So the very first release of
`@xemas-security/sdk@0.1.0` could not itself be made by OIDC.

It was published once with a credential scoped as narrowly as npm allows:

- a **granular access token**, not a classic or login token;
- **one scope** (`@xemas-security`), read and write — the package could not be selected because it
  did not exist yet;
- **no organization access** — publishing needs package write, not org administration;
- **7-day expiry**, the shortest offered;
- **revoked immediately** after the publish succeeded, not left to expire.

`npm login` was deliberately *not* used: it stores a session token with full user privileges, which
is broader than the granular token above.

Every release from `0.1.1` onward goes through OIDC. If you find yourself reaching for a token,
something is misconfigured — check the publisher record and the `release` environment before
reaching for a credential.

### Why the first OIDC release matters

The bootstrap publish demonstrates nothing about whether trusted publishing works. `0.1.1` was the
first release that actually proved it: published from CI with no token present in the repository.

## Provenance

Publishing from a public repository with trusted publishing generates provenance attestations
automatically. They only verify if `package.json`'s `repository` field matches this repository
exactly — currently `git+https://github.com/xemasio/xemas-typescript.git`. Changing it silently
breaks provenance without breaking the publish.
