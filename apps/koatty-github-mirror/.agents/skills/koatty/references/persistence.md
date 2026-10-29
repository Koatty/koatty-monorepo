# Persistence: entities, repositories, transactions

## CRUD generation and its honest limits

The CLI module generator (`koatty plan --spec <yaml>` + `koatty apply`) generates Model/DTO/Service/Controller/Test in one pass. Its support matrix is enforced before any write:

- The Model uses a numeric auto-increment primary key named `id`; other primary keys are rejected (`UNSUPPORTED_SPEC`).
- `api.type` is `rest` | `grpc` | `graphql` only; websocket controllers come from `koatty controller <name> -t websocket`.
- Custom `api.endpoints` are rejected: the generated controller exposes a fixed CRUD surface (list/detail/create/update/delete). Add custom actions afterwards with the host editor or the http-action recipe.
- Do not assume every legacy Spec feature is fully implemented. For the AI `crud` recipe, inspect `recipes --id crud`: it deliberately accepts a narrower schema (string/number/boolean fields and fixed CRUD routes). Use the host editor and targeted tests for unsupported mappings.

Specs need at least one field; the standard example layout:

```yaml
module: article
fields:
  id: {name: id, type: number, primary: true}
  title: {name: title, type: string, required: true, length: 120}
api: {type: rest, basePath: /articles, endpoints: []}
dto: {create: true, update: true, query: true}
features: {pagination: true}
```

## Entity and repository rules

- Entities (`src/model/**`) extend TypeORM's `BaseEntity` with `@Entity()`/`@Column()` decorators; generated CRUD is not proof of database correctness — the schema, connection and migrations remain application configuration.
- Transaction boundaries belong in Services. Keep transactions short, pass the entity manager explicitly where the project does, and never let an HTTP request carry long-running work.
- Generated CRUD assumes a real database at runtime; tests use repository spies (see [testing.md](testing.md)) and add real database acceptance when database behavior is part of the requirement.

## Optional persistence components

| Need | Package | Verify before relying on it |
|---|---|---|
| Relational data | koatty_typeorm + TypeORM | driver/connection/migrations; transaction boundaries |
| Cache | koatty_cacheable | TTL, key scope; plain get/set is not atomic CAS |
| KV store | koatty_store | backend behavior and consistency guarantees |
| Scheduled work | koatty_schedule | overlap policy, distributed lock backend, shutdown |

`koatty-ai docs --api <Name>` + `koatty-ai context` confirm what the project actually installed before you import anything.

For AI tools use `plan --recipe crud --params <JSON> --savePlan`, review the result and apply the returned planId. For a non-database service use the `component` recipe instead.
