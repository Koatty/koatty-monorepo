#!/usr/bin/env node
/**
 * PERF-01 benchmark: router hot path.
 *
 * Compares the legacy per-request pipeline (build array + koa-compose on every
 * request) with the registration-time handler returned by `createRouteHandler`.
 *
 * Usage:  node benchmark/router-hotpath.js
 * (run inside packages/koatty-router; the TypeScript sources are compiled on the fly)
 */
'use strict';

const path = require('path');
const Module = require('module');

// Compile TS on the fly (ts-node is a dev dependency of this package).
try {
  require('ts-node').register({
    transpileOnly: true,
    // the package tsconfig targets a bundler moduleResolution; ts-node needs CJS here
    compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2020' },
  });
} catch (err) {
  console.error('ts-node is required to run this benchmark:', err.message);
  process.exit(1);
}

const compose = require('koa-compose');
const { createRouteHandler } = require(path.join(__dirname, '..', 'src', 'utils', 'handler.ts'));

const app = {};
const controller = { index: () => 'ok' };

function makeCtx() {
  return { body: undefined };
}

/** legacy hot path: allocate + compose on every request */
function legacyInvoke(ctx, ctl) {
  const middlewareFns = [];
  middlewareFns.push(async (c, next) => { await ctl.index(); if (c.body === undefined) c.body = 'ok'; await next(); });
  return compose(middlewareFns)(ctx, async () => {}).then(() => ctx.body);
}

const invoke = createRouteHandler(app, 'index');

const ITERATIONS = Number(process.env.ITERATIONS || 200000);

function run(name, fn) {
  // warmup
  for (let i = 0; i < 5000; i++) fn({ body: undefined }, controller);
  const start = process.hrtime.bigint();
  for (let i = 0; i < ITERATIONS; i++) {
    const ctx = { body: undefined };
    fn(ctx, controller);
  }
  const ns = Number(process.hrtime.bigint() - start);
  const perOp = ns / ITERATIONS;
  return { name, perOp, opsPerSec: 1e9 / perOp };
}

async function asyncRun(name, fn) {
  for (let i = 0; i < 2000; i++) await fn({ body: undefined }, controller);
  const start = process.hrtime.bigint();
  for (let i = 0; i < ITERATIONS; i++) {
    // keep allocations identical between the two variants
    await fn({ body: undefined }, controller);
  }
  const ns = Number(process.hrtime.bigint() - start);
  const perOp = ns / ITERATIONS;
  return { name, perOp, opsPerSec: 1e9 / perOp };
}

(async () => {
  const results = [];
  results.push(await asyncRun('legacy  (compose per request)', (ctx, ctl) => legacyInvoke(ctx, ctl)));
  results.push(await asyncRun('new     (pre-built handler)  ', (ctx, ctl) => invoke(ctx, ctl)));

  const legacy = results[0].perOp;
  const next = results[1].perOp;
  console.log(`iterations: ${ITERATIONS}\n`);
  for (const r of results) {
    console.log(`  ${r.name}: ${r.perOp.toFixed(0)} ns/op  (${Math.round(r.opsPerSec).toLocaleString('en-US')} ops/s)`);
  }
  const gain = ((legacy - next) / legacy) * 100;
  console.log(`\n  per-request pipeline cost reduction: ${gain.toFixed(1)}%`);
  console.log('  note: this measures the handler layer only; end-to-end RPS depends on the server and payload.');
})();
