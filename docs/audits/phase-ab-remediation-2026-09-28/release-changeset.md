---
"koatty_cli": patch
"koatty_container": patch
"koatty_core": patch
"koatty_router": patch
"koatty_validation": patch
"koatty_serve": patch
"koatty_typeorm": patch
---

Fix Phase A/B audit findings: constrain every CLI write to the project, enforce TypeORM logging levels and mask positional parameters, pass sanitized DTOs to business methods with explicit partial validation, fail GraphQL startup on missing complexity support and bound fragment traversal, clean incomplete uploads, compare complete WebSocket origins and limit upgrades, prevent repeated Around business execution, reject malformed XML, isolate request parser state, require tokens for health details, and freeze nested security settings.

GraphQL applications with complexity protection enabled must install graphql-query-complexity ^2.0.0. CLI writes through symlinks are rejected. Health details require a valid configured token even on private networks. TC39 synchronous @Validated requires explicit types in its options.
