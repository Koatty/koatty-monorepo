## Unreleased — Phase A–F review (2026-09-30)

Declare koatty_serve as a runtime peer and workspace development dependency.

Migration: `docs/migration/phase-a-f-review-fixes.md` in the monorepo. No release has been applied.

# Changelog

## Unreleased

- Extract the experimental HTTP/3 adapter and frame/QPACK helpers from koatty_serve.
- Load the native backend only at startup and fail closed if unavailable; remove simulated native listening.
- Reuse the Serve connection tracker and coordinated shutdown; preserve existing protocol configuration.
- Keep 68 moved frame/QPACK/simulation regressions and add entry-point/backend-failure checks. Real QUIC interoperability remains unverified.
