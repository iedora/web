# Security policy

Iedora is a solo-maintained, closed-source SaaS — the source lives in a
public repository so that supply-chain tooling (Renovate, CodeQL, OpenSSF
Scorecard, Trivy, SLSA provenance) can operate transparently, but the
product itself is not open-source.

## Supported versions

Only the latest commit on `main` is supported. There are no release
branches; CD ships every green merge to production.

## Reporting a vulnerability

**Please do not open a public issue or pull request for security
vulnerabilities.**

Use [GitHub's private security advisory flow](https://github.com/eduvhc/iedora/security/advisories/new)
to report a finding. The advisory creates a private discussion thread
visible only to the maintainer.

What to include:
- a short description of the impact (what an attacker can achieve)
- repro steps or a proof of concept
- the affected commit SHA or the URL where you observed the issue
- whether you have already disclosed this elsewhere

I will acknowledge within **3 business days** (Europe/Lisbon time) and
follow up with a fix timeline once the report is triaged. Reports that
affect a public production surface (`menu.iedora.com`,
`genkan.iedora.com`, `iedora.com`) are prioritised over reports against
unreleased branches.

## Scope

In scope:
- the three product surfaces above and their auth / data flows
- the genkan IdP (OIDC server, OAuth provider, audit chain, JWKS rotation)
- the iedora-identity webhook envelope (signing, replay protection, SSRF)
- the CI/CD supply chain (GitHub Actions, Tofu deploy, GHCR image build)

Out of scope:
- denial-of-service findings that require flooding (the homelab is rate-
  and bandwidth-limited; DoS is a known posture)
- missing security headers without a demonstrable exploit
- social engineering and physical attacks
- third-party dependencies whose vendors have their own disclosure
  channels (please report upstream and CC me on the advisory)

## Bounty

This is a solo, pre-revenue project — there is no monetary bounty
programme. Credit in the advisory and a public thank-you in the
changelog are the only recognition I can offer right now. If the project
reaches a stage where bounties make sense, this section will be updated.
