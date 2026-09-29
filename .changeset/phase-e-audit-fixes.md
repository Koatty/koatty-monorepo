---
"koatty_cli": patch
"koatty_testing": patch
"koatty_router": patch
---

Fix Phase E audit findings: bind MCP writes to issued session plans and unchanged files, validate inputs and recover handled write failures, reject documentation/source symlink escapes, and correctly classify test execution. Add static manifest JSON Schemas and unresolved diagnostics without leaking configuration expressions/defaults. Align generated DTO/controller/service code and docs with existing APIs and test generated HTTP requests. Wait for test-app readiness and restore environment after cleanup failures. Preserve HTTP 400 for DTO validation and correctly extract mixed primitive/DTO parameters.
