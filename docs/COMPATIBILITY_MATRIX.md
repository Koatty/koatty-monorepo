# Koatty Compatibility Matrix

This document shows the compatibility between all Koatty packages.

## Package Versions

| Package | Version | Node.js | Koatty Dependencies |
|---------|---------|---------|---------------------|
| koatty | 4.0.0 | >=18.0.0 | koatty_config@workspace:*, koatty_container@^1.17.0, koatty_core@workspace:*, koatty_exception@workspace:*, koatty_lib@^1.4.3, koatty_loader@^1.3.0, koatty_logger@2.8.1, koatty_router@workspace:*, koatty_serve@workspace:*, koatty_trace@workspace:* |
| koatty_config | 1.2.2 | >12.0.0 | koatty_container@^1.x.x, koatty_core@workspace:*, koatty_lib@^1.x.x, koatty_loader@^1.x.x, koatty_logger@^2.x.x |
| koatty_core | 2.0.8 | >=18.0.0 | koatty_container@^1.x.x, koatty_exception@workspace:*, koatty_lib@^1.x.x, koatty_logger@^2.x.x |
| koatty_exception | 2.0.4 | >10.0.0 | koatty_container@^1.x.x, koatty_lib@^1.x.x, koatty_logger@^2.x.x |
| koatty_router | 2.0.2 | >=18.0.0 | koatty_container@^1.x.x, koatty_core@workspace:*, koatty_exception@workspace:*, koatty_graphql@^1.x.x, koatty_lib@^1.x.x, koatty_logger@^2.x.x, koatty_proto@^1.x.x, koatty_validation@^1.x.x |
| koatty_serve | 3.0.0 | >=18.0.0 | koatty_container@^1.x.x, koatty_core@workspace:*, koatty_exception@workspace:*, koatty_lib@^1.x.x, koatty_logger@^2.x.x, koatty_proto@^1.x.x, koatty_validation@^1.x.x |
| koatty_trace | 2.0.0 | >10.0.0 | koatty_container@^1.x.x, koatty_lib@^1.x.x, koatty_logger@^2.x.x |

## Legend

- **workspace:***: Package is part of the monorepo
- **^x.x.x**: Semantic versioning range

## Note

This matrix is automatically generated. Do not edit manually.
