---
"koatty": patch
"koatty_cacheable": patch
"koatty_config": minor
"koatty_container": minor
"koatty_core": patch
"koatty_schedule": patch
"koatty_serve": patch
"koatty_store": minor
"koatty_trace": patch
---

Close Phase C audit findings: await singleton initialization and reverse disposal, make shutdown idempotent and drain responses complete, handle real gRPC deadlines and stream termination, bound lock renewal with cooperative cancellation, await scheduler drain, validate JSON Schema and explicit security profiles, isolate Redis native leases/transactions, and preserve cached types with single flight.

Redis transactions now return an explicit isolated handle; native connections must be released. Untyped legacy cache entries are treated as misses. JSON Schema requires optional peer ajv 8. See docs/migration/phase-c-audit-remediation.md before release. Linux/Redis CI and independent package consumption remain release gates.
