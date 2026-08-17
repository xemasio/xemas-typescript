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

Three things break publishing if changed carelessly:

- **Renaming `release.yml`.** The filename is part of the identity. Renaming it breaks publishing
  until the npm publisher record is updated to match.
- **Confusing the namespaces.** The npm *scope* is `@xemas-security`; the *GitHub owner* is
  `xemasio`. The publisher record needs the GitHub one. This exact mistake was made once on PyPI
  (`pbk714290` entered instead of `xemasio`) and would have failed at publish time.
- **Publishing before the trusted publisher record exists.** It fails with an error that points
  everywhere except the actual cause. See below.

### Diagnosing a failed OIDC publish (observed 2026-08-16/17)

`0.1.1` failed twice before succeeding, and the two failure messages were different enough to send
the investigation down a wrong path. Both had **one** cause: no trusted publisher was configured on
`npmjs.com/package/@xemas-security/sdk/access` yet.

| Attempt | Workflow | Publisher record | Result |
|---|---|---|---|
| 1 | with `registry-url` | not configured | `E404 ... PUT /@xemas-security%2fsdk - Not found` |
| 2 | `registry-url` removed | not configured | `ENEEDAUTH ... need auth` |
| 3 | with `registry-url` (re-run of attempt 1) | **configured** | published, with provenance |

Why the same cause produced two errors:

- **With `registry-url`**, `actions/setup-node` writes an `.npmrc` containing
  `_authToken=${NODE_AUTH_TOKEN}` and exports `NODE_AUTH_TOKEN` as a literal placeholder when no
  secret is supplied. npm attempts token auth with that meaningless value and is rejected. npm
  answers unauthorized publishes with **404 rather than 403**, so the registry does not disclose
  which private packages exist - which is why an auth failure reads as a missing package.
- **Without it**, npm has no credential to try at all, so it says so plainly: `ENEEDAUTH`.

**The trap worth remembering:** the second error looked like progress, so the change that produced
it looked like a partial fix. It was not - it was the same failure with the misleading placeholder
removed. Attempt 3 published from `873765f`, the commit that still HAD `registry-url`, which proves
`registry-url` does not prevent trusted publishing. A changed error message is not evidence that
the change was corrective.

`registry-url` is nonetheless still absent from the publish job, on the narrower and true claim
that it contributes a placeholder credential that turns a clear `ENEEDAUTH` into a misleading 404.
That is a diagnosability improvement, not a functional one.

**Check the publisher record first.** It is the one input that lives outside this repository, so it
is the one nothing in the codebase can confirm. The `Check GitHub issued an OIDC token` step in the
workflow narrows the rest: if those variables are present and publishing still fails, the problem is
the registry-side record, not this workflow.

### How to verify a publish really used OIDC

Not from the CLI's success line, and not from the fact that the version appears. Check the package
page for a **Provenance** block naming the source commit, the build file and a transparency-log
entry, or:

```bash
npm view @xemas-security/sdk@<version> dist.attestations
```

Provenance attestations are produced by trusted publishing and cannot be produced by a token, so
they are the only self-evidencing proof that no credential was involved.

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

### The first OIDC release: PROVED (2026-08-17)

The bootstrap publish demonstrated nothing about whether trusted publishing works - only that a
human with a browser session can publish. `0.1.1` cut that question, and the answer is recorded
rather than assumed:

| | |
|---|---|
| Run | [31978864209](https://github.com/xemasio/xemas-typescript/actions/runs/31978864209) |
| Source commit | `873765f` |
| Provenance | SLSA v1 attestation, signed on GitHub Actions, in the public transparency log |

No token existed in the repository, on a developer machine, or in any environment at any point in
that release. The provenance attestation is the load-bearing evidence: it is generated by the
registry from the OIDC claim and cannot be produced by a token publish, so it demonstrates the
absence of a credential rather than merely asserting it.

The same pipeline is proved on PyPI: `xemas-sdk 0.1.0` published by OIDC with no token, and PyPI
converted its *pending* publisher to an *active* one - the registry's own confirmation that the
identity matched.

## Provenance

Publishing from a public repository with trusted publishing generates provenance attestations
automatically. They only verify if `package.json`'s `repository` field matches this repository
exactly — currently `git+https://github.com/xemasio/xemas-typescript.git`. Changing it silently
breaks provenance without breaking the publish.
