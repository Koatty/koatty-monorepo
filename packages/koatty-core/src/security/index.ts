/**
 * @ description: Security defaults module barrel (ADR-102 / B-0).
 *
 * `SecurityProfile` centralizes the fail-closed defaults used across the
 * framework; `Application` resolves it and exposes it as the read-only
 * `app.security`.
 *
 * @module security
 */
export * from "./profile";
