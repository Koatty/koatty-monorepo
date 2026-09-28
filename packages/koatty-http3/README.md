# koatty_http3 (experimental)

Optional HTTP/3 transport extracted from `koatty_serve`. Ordinary HTTP/HTTPS/HTTP2/WS/gRPC applications do not install or load the QUIC backend.

Install this package in the application alongside the matching `koatty_serve` release, then keep the existing `config/server.ts` protocol setting:

```ts
export default {
  protocol: 'http3', hostname: '127.0.0.1', port: 8443,
  ssl: { key: './certs/server.key', cert: './certs/server.crt' }
};
```

Direct consumers import `Http3Server` from `koatty_http3`, instead of `koatty_serve`. No new decorator is required. `koatty_serve/internal` is the version-coupled extension contract; it is not an application API.

The native `@matrixai/quic` backend loads when listening starts. An unavailable backend rejects startup; no simulated listener or ready signal is returned. Mutual TLS is currently unsupported and rejected. Frame/QPACK unit tests and simulated transport tests are included; real QUIC interoperability and production readiness have not been established. Do not treat these tests as full RFC 9114/9204 compliance.

This package has not been published from this workspace. See the monorepo Phase A–D completion audit for release gates and migration details.
