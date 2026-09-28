# Koatty Compatibility Matrix

This document shows the compatibility between all Koatty packages.

## Package Versions

| Package | Version | Node.js | Koatty Dependencies |
|---------|---------|---------|---------------------|
| koatty | 4.4.0 | >=18.0.0 | koatty_config@workspace:*, koatty_container@workspace:*, koatty_core@workspace:*, koatty_exception@workspace:*, koatty_lib@workspace:*, koatty_loader@workspace:*, koatty_logger@workspace:*, koatty_router@workspace:*, koatty_serve@workspace:*, koatty_trace@workspace:* |
| koatty_cacheable | 5.0.0 | >=18.0.0 | koatty_container@^4.0.0, koatty_core@^2.4.0, koatty_lib@^1.6.0, koatty_logger@^3.1.0, koatty_store@^4.0.0 |
| koatty_cli | 4.2.2 | >=18.0.0 | - |
| koatty_config | 1.4.3 | >=18.0.0 | koatty_container@workspace:*, koatty_core@workspace:*, koatty_lib@workspace:*, koatty_loader@workspace:*, koatty_logger@workspace:* |
| koatty_container | 4.0.0 | >=20.0.0 | koatty_lib@^1.6.0, koatty_logger@^3.1.0 |
| koatty_core | 2.5.0 | >=18.0.0 | koatty_container@workspace:*, koatty_exception@workspace:*, koatty_lib@workspace:*, koatty_logger@workspace:* |
| koatty_exception | 2.2.2 | >=18.0.0 | koatty_container@workspace:*, koatty_lib@workspace:*, koatty_logger@workspace:* |
| koatty_graphql | 2.0.1 | >=18.0.0 | koatty_lib@^1.6.0 |
| koatty_lib | 1.6.0 | >=18.0.0 | - |
| koatty_loader | 2.0.1 | >=18.0.0 | koatty_lib@^1.6.0 |
| koatty_logger | 3.1.1 | >=18.0.0 | koatty_lib@^1.6.0 |
| koatty_proto | 2.0.0 | >=18.0.0 | koatty_lib@^1.6.0 |
| koatty_router | 2.4.1 | >=18.0.0 | koatty_container@workspace:*, koatty_core@workspace:*, koatty_exception@workspace:*, koatty_graphql@workspace:*, koatty_lib@workspace:*, koatty_logger@workspace:*, koatty_proto@workspace:*, koatty_validation@workspace:* |
| koatty_schedule | 6.1.0 | >=18.0.0 | koatty_container@^4.0.0, koatty_core@^2.4.0, koatty_lib@^1.6.0, koatty_logger@^3.1.0, koatty_store@workspace:* |
| koatty_serve | 3.5.0 | >=18.0.0 | koatty_container@workspace:*, koatty_core@workspace:*, koatty_exception@workspace:*, koatty_lib@workspace:*, koatty_logger@workspace:*, koatty_proto@workspace:*, koatty_validation@workspace:* |
| koatty_serverless | 5.0.0 | >=18.0.0 | koatty_core@workspace:* |
| koatty_store | 4.0.0 | >=18.0.0 | koatty_lib@^1.6.0, koatty_logger@^3.1.0 |
| koatty_swagger | 3.0.0 | >=18.0.0 | koatty_lib@^1.6.0 |
| koatty_testing | 4.0.0 | >=18.0.0 | koatty_container@^4.0.0, koatty_core@^2.5.0, koatty_lib@^1.6.0 |
| koatty_trace | 2.4.0 | >=18.0.0 | koatty_container@workspace:*, koatty_lib@workspace:*, koatty_logger@workspace:* |
| koatty_typeorm | 3.0.0 | >=18.0.0 | koatty_container@workspace:*, koatty_core@workspace:*, koatty_lib@workspace:*, koatty_logger@workspace:* |
| koatty_validation | 4.0.0 | >=18.0.0 | koatty_container@^4.0.0, koatty_lib@^1.6.0, koatty_logger@^3.1.0 |
| koatty-doc | 1.1.0 | - | - |

## Legend

- **workspace:***: Package is part of the monorepo
- **^x.x.x**: Semantic versioning range

## Note

This matrix is automatically generated. Do not edit manually.
