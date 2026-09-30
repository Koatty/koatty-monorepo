## Unreleased — Phase A–F review (2026-09-30)

## 1.0.0

### Minor Changes

- f0e9278: Close the second Phase A–F review: strict security config validation and environment resolution, explicit metrics trust, default WS Origin checks, hard-link-safe CLI writes and delimited tool arguments, DTO transformation and conservative schema diagnostics, privacy-safe telemetry, HTTP3 peer ownership and draining reference SSE service. MCP/LLM/Guard first-release major entries are in phase-f-audit-hardening. See docs/migration/phase-a-f-review-fixes.md. Do not treat local tests as release/client/provider acceptance.

### Patch Changes

- Updated dependencies [f0e9278]
- Updated dependencies [f0e9278]
- Updated dependencies [f0e9278]
- Updated dependencies [f0e9278]
  - koatty_core@2.7.0
  - koatty_serve@4.0.0

Declare koatty_serve as a runtime peer and workspace development dependency.

Migration: `docs/migration/phase-a-f-review-fixes.md` in the monorepo. No release has been applied.

# Changelog

## Unreleased

- Extract the experimental HTTP/3 adapter and frame/QPACK helpers from koatty_serve.
- Load the native backend only at startup and fail closed if unavailable; remove simulated native listening.
- Reuse the Serve connection tracker and coordinated shutdown; preserve existing protocol configuration.
- Keep 68 moved frame/QPACK/simulation regressions and add entry-point/backend-failure checks. Real QUIC interoperability remains unverified.
