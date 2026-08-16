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

### What actually happened (2026-08-16)

A granular access token was prepared - one scope (`@xemas-security`), read/write, no organization
access, 7-day expiry - but **it was never used**. The value written to `.npmrc` was a placeholder,
so npm rejected it and fell back to **browser-based CLI authentication**. The publish then
succeeded through that session:

```
GET 200  /-/v1/done?authId=***                     <- browser auth completed
PUT 200  registry.npmjs.org/@xemas-security%2fsdk  <- package accepted
```

That is a better outcome than intended. The web-auth session was written to the *project* `.npmrc`,
which was deleted immediately afterwards, so no credential persisted anywhere - `npm whoami` returns
`ENEEDAUTH`. The unused granular token was revoked rather than left to expire.

`npm login` at the shell was deliberately not used: it writes a session token to the *user-level*
`~/.npmrc`, where it survives until explicitly removed.

### `+ package@version` does not mean installable

npm printed `+ @xemas-security/sdk@0.1.0` immediately, but the registry served **404 for roughly
two minutes** afterwards, across repeated polls. A first publish of a brand-new scoped package
takes time to propagate.

So the release check is a **clean install from an empty directory**, never the CLI's success line
and never the npmjs.com page:

```bash
mkdir /tmp/sdk-check && cd /tmp/sdk-check && npm init -y
npm install @xemas-security/sdk
node --input-type=module -e "import {Xemas} from '@xemas-security/sdk'; new Xemas({apiKey:'sk-xemas-x'}); console.log('ok')"
```

Every release from `0.1.1` onward goes through OIDC. If you find yourself reaching for a token,
something is misconfigured — check the publisher record and the `release` environment before
reaching for a credential.

### Why the first OIDC release matters

The bootstrap publish demonstrates nothing about whether trusted publishing works - it proves only
that a human with a browser session can publish. **As of 0.1.0, trusted publishing is configured
but UNPROVEN.**

`0.1.1` is the release that will actually prove it: published from CI, with no credential present
in the repository and no human holding one. Until that release succeeds, treat OIDC publishing as
untested and do not assume a future release will "just work".

Update this section once it has, and say which version proved it.

## Provenance

Publishing from a public repository with trusted publishing generates provenance attestations
automatically. They only verify if `package.json`'s `repository` field matches this repository
exactly — currently `git+https://github.com/xemasio/xemas-typescript.git`. Changing it silently
breaks provenance without breaking the publish.
