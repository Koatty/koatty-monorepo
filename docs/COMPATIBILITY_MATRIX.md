# Koatty Compatibility Matrix

This document shows the compatibility between all Koatty packages as of the **v5.0.0 family release (2026-09-30)**.

## Package Versions

| Package | Version | Node.js | Koatty Dependencies |
|---------|---------|---------|---------------------|

Packages maintained in the monorepo root:
| koatty_guard | 1.0.0 | >=18.0.0 | koatty_container@^4.1.0, koatty_core@^2.7.0, koatty_lib@^1.6.1, koatty_logger@^3.1.2 |
| koatty_llm | 1.0.0 | >=18.0.0 | koatty_validation@^5.0.0, koatty_cacheable@^6.0.0, koatty_store@^4.1.0 |
| koatty_mcp | 1.0.0 | >=18.17.0 | koatty_container@^4.1.0, koatty_core@^2.7.0, koatty_lib@^1.6.1, koatty_logger@^3.1.2, koatty_validation@^5.0.0 |
| koatty | 5.0.0 | >=18.0.0 | koatty_config@workspace:*, koatty_container@workspace:*, koatty_core@workspace:*, koatty_exception@workspace:*, koatty_lib@workspace:*, koatty_loader@workspace:*, koatty_logger@workspace:*, koatty_router@workspace:*, koatty_serve@workspace:*, koatty_trace@workspace:* |

Packages maintained as git submodules:
| koatty_cli | 5.1.0 | >=18.0.0 | koatty_validation@workspace:* |
| koatty_cacheable | 6.0.0 | >=18.0.0 | koatty_container@^4.1.0, koatty_core@^2.7.0, koatty_lib@^1.6.1, koatty_logger@^3.1.2, koatty_store@^4.1.0 |
| koatty_config | 1.5.0 | >=18.0.0 | koatty_container@workspace:*, koatty_core@workspace:*, koatty_lib@workspace:*, koatty_loader@workspace:*, koatty_logger@workspace:* |
| koatty_container | 4.1.0 | >=20.0.0 | koatty_lib@^1.6.1, koatty_logger@^3.1.2 |
| koatty_core | 2.7.0 | >=18.0.0 | koatty_container@workspace:*, koatty_exception@workspace:*, koatty_lib@workspace:*, koatty_logger@workspace:* |
| koatty_exception | 2.2.3 | >=18.0.0 | koatty_container@workspace:*, koatty_lib@workspace:*, koatty_logger@workspace:* |
| koatty_graphql | 2.0.2 | >=18.0.0 | koatty_lib@^1.6.1 |
| koatty_http3 | 1.0.0 | >=18.0.0 | koatty_core@workspace:*, koatty_serve@>=4.0.0 |
| koatty_lib | 1.6.1 | >=18.0.0 | - |
| koatty_loader | 2.1.0 | >=18.0.0 | koatty_lib@^1.6.1 |
| koatty_logger | 3.1.2 | >=18.0.0 | koatty_lib@^1.6.1 |
| koatty_proto | 2.0.1 | >=18.0.0 | koatty_lib@^1.6.1 |
| koatty_router | 2.5.0 | >=18.0.0 | koatty_container@workspace:*, koatty_core@workspace:*, koatty_exception@workspace:*, koatty_graphql@workspace:*, koatty_lib@workspace:*, koatty_logger@workspace:*, koatty_proto@workspace:*, koatty_validation@workspace:* |
| koatty_schedule | 7.0.0 | >=18.0.0 | koatty_container@^4.1.0, koatty_core@^2.7.0, koatty_lib@^1.6.1, koatty_logger@^3.1.2, koatty_store@workspace:* |
| koatty_serve | 4.0.0 | >=18.0.0 | koatty_container@workspace:*, koatty_core@workspace:*, koatty_exception@workspace:*, koatty_lib@workspace:*, koatty_logger@workspace:*, koatty_proto@workspace:*, koatty_validation@workspace:* |
| koatty_serverless | 6.0.0 | >=18.0.0 | koatty_core@workspace:*, koatty@workspace:* |
| koatty_store | 4.1.0 | >=18.0.0 | koatty_lib@^1.6.1, koatty_logger@^3.1.2 |
| koatty_swagger | 4.0.0 | >=18.0.0 | koatty_lib@^1.6.1, koatty@workspace:* |
| koatty_testing | 5.0.0 | >=18.0.0 | koatty@^5.0.0, koatty_container@^4.1.0, koatty_core@^2.7.0, koatty_lib@^1.6.1 |
| koatty_trace | 2.5.0 | >=18.0.0 | koatty_container@workspace:*, koatty_lib@workspace:*, koatty_logger@workspace:*, koatty_core@workspace:*, koatty_exception@workspace:* |
| koatty_typeorm | 4.0.0 | >=18.0.0 | koatty_container@workspace:*, koatty_core@workspace:*, koatty_lib@workspace:*, koatty_logger@workspace:* |
| koatty_validation | 5.0.0 | >=18.0.0 | koatty_container@^4.1.0, koatty_lib@^1.6.1, koatty_logger@^3.1.2 |

## Legend

- **workspace:***: Package is part of the monorepo (the published artifact pins concrete versions)
- **^x.x.x**: Semantic versioning range

## Note

This matrix reflects the applied changesets of the v5.0.0 family release. Regenerate rows from each package.json (name / version / engines.node / koatty dependencies) rather than editing versions by hand.
