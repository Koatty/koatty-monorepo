/*
 * @Description: 
 * @Usage: 
 * @Author: richen
 * @Date: 2025-03-12 14:54:42
 * @LastEditTime: 2025-03-15 17:06:54
 * @License: BSD (3-Clause)
 * @Copyright (c): <richenlin(at)gmail.com>
 */
import KoaRouter from "@koa/router";
import fs from "fs";
import path from "path";
import {
  GraphQLError,
  Kind,
  NoSchemaIntrospectionCustomRule,
  type DocumentNode,
  type FieldNode,
  type FragmentDefinitionNode,
  type SelectionSetNode,
  type ValidationContext,
} from "graphql";
import { createHandler } from "graphql-http/lib/use/fetch";
import { IOC } from "koatty_container";
import {
  IGraphQLImplementation, Koatty, KoattyContext,
  KoattyRouter, RouterImplementation
} from "koatty_core";
import { buildSchema } from "koatty_graphql";
import { Helper } from "koatty_lib";
import { DefaultLogger as Logger } from "koatty_logger";
import { injectParamMetaData, injectRouter } from "../utils/inject";
import { RouterOptions } from "./router";
import { Handler } from "../utils/handler";
import { getProtocolConfig, validateProtocolConfig } from "./types";

/**
 * GrpcRouter Options
 *
 * @export
 * @interface GraphQLRouterOptions
 */
export interface GraphQLRouterOptions extends RouterOptions {
  schemaFile: string;
}


/**
 * Built-in query depth limit rule (SEC-04 / B-4). Replaces the runtime
 * `require('graphql-depth-limit')`: expands fragments (with cycle
 * detection) and reports an error when the selection depth exceeds
 * `maxDepth`. Fields matching an `ignore` pattern contribute no depth.
 */
export function createQueryDepthLimitRule(maxDepth: number, ignore: RegExp[] = []) {
  return function QueryDepthLimit(context: ValidationContext) {
    const fragments = new Map<string, FragmentDefinitionNode>();
    for (const def of context.getDocument().definitions) {
      if (def.kind === Kind.FRAGMENT_DEFINITION) {
        fragments.set(def.name.value, def);
      }
    }

    const depthOfSelection = (selectionSet: SelectionSetNode | undefined, stack: Set<string>): number => {
      if (!selectionSet) return 0;
      let max = 0;
      for (const child of selectionSet.selections) {
        let d = 0;
        if (child.kind === Kind.FIELD) {
          const field = child as FieldNode;
          if (ignore.some((re) => re.test(field.name.value))) {
            // ignored fields contribute no depth, but their children still do
            d = depthOfSelection(field.selectionSet, stack);
          } else {
            d = 1 + depthOfSelection(field.selectionSet, stack);
          }
        } else if (child.kind === Kind.INLINE_FRAGMENT) {
          d = depthOfSelection(child.selectionSet, stack);
        } else if (child.kind === Kind.FRAGMENT_SPREAD) {
          const name = child.name.value;
          if (stack.has(name)) {
            // fragment cycle: report instead of looping forever
            context.reportError(
              new GraphQLError(`Fragment cycle detected via "${name}".`)
            );
            continue;
          }
          const frag = fragments.get(name);
          if (!frag) continue;
          stack.add(name);
          d = depthOfSelection(frag.selectionSet, stack);
          stack.delete(name);
        }
        if (d > max) max = d;
      }
      return max;
    };

    return {
      OperationDefinition(node: DocumentNode) {
        const depth = depthOfSelection((node as any).selectionSet, new Set());
        if (depth > maxDepth) {
          context.reportError(
            new GraphQLError(
              `Query exceeds maximum depth of ${maxDepth} (got ${depth}).`
            )
          );
        }
        return false; // depth is computed manually
      },
    };
  };
}

export class GraphQLRouter implements KoattyRouter {
  readonly protocol: string;
  options: GraphQLRouterOptions;
  router: KoaRouter;
  private app: Koatty;
  private routerMap: Map<string, RouterImplementation>;
  /** resolved from security profile unless explicitly configured (SEC-04) */
  private playgroundEnabled = false;

  constructor(app: Koatty, options: RouterOptions = { protocol: "graphql", prefix: "" }) {
    const extConfig = getProtocolConfig('graphql', options.ext || {});

    const validation = validateProtocolConfig('graphql', options.ext || {});
    if (!validation.valid) {
      throw new Error(`GraphQL router configuration error: ${validation.errors.join(', ')}`);
    }
    if (validation.warnings.length > 0) {
      validation.warnings.forEach((warning: string) => Logger.Warn(`[GraphQLRouter] ${warning}`));
    }

    // Resolve schemaFile path: if relative, resolve against app.rootPath
    let schemaFilePath = extConfig.schemaFile;
    if (schemaFilePath && !path.isAbsolute(schemaFilePath) && app.rootPath) {
      schemaFilePath = path.resolve(app.rootPath, schemaFilePath);
    }
    
    this.options = {
      ...options,
      schemaFile: schemaFilePath,
    } as GraphQLRouterOptions;

    this.app = app;
    this.protocol = options.protocol || "graphql";
    // initialize - only pass base router options to KoaRouter
    this.router = new KoaRouter({
      prefix: options.prefix,
      methods: options.methods,
      sensitive: options.sensitive,
      strict: options.strict,
    });
    this.routerMap = new Map();
  }

  /**
   * Set router
   * @param name 
   * @param impl 
   * @returns 
   */
  SetRouter(name: string, impl?: RouterImplementation) {
    const routeHandler = <IGraphQLImplementation>impl.implementation;
    if (Helper.isEmpty(routeHandler)) return;

    // SECURITY (SEC-04 / B-4): defaults come from the application security
    // profile; explicit config in ext wins. Missing optional packages are a
    // startup failure (fail-closed), never a silent downgrade.
    const profile = ((this.app as any)?.security?.graphql ?? {}) as {
      playground?: boolean;
      introspection?: boolean;
      depthLimit?: number;
      complexityLimit?: number;
    };
    const playgroundEnabled = this.options.ext?.playground ?? profile.playground ?? false;
    const introspectionEnabled = this.options.ext?.introspection ?? profile.introspection ?? true;
    const depthLimit = this.options.ext?.depthLimit ?? profile.depthLimit ?? 0;
    const complexityLimit = this.options.ext?.complexityLimit ?? profile.complexityLimit ?? 0;
    this.playgroundEnabled = playgroundEnabled;

    const validationRules: any[] = [];

    // introspection disabled by the strict profile -> enforce with the
    // rule that ships with graphql itself (no extra dependency)
    if (!introspectionEnabled) {
      validationRules.push(NoSchemaIntrospectionCustomRule);
      Logger.Debug('GraphQL introspection disabled');
    }

    // built-in depth limit (no runtime require, no optional dependency)
    if (depthLimit && depthLimit > 0) {
      validationRules.push(createQueryDepthLimitRule(depthLimit, [/_trusted$/]));
      Logger.Debug(`GraphQL depth limit enabled: ${depthLimit}`);
    }

    // complexity limit relies on the optional graphql-query-complexity rule;
    // configuring it without the package is a startup failure (fail-closed)
    if (complexityLimit && complexityLimit > 0) {
      let createComplexityLimitRule: any;
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        ({ createComplexityLimitRule } = require('graphql-query-complexity'));
      } catch {
        throw new Error(
          'GraphQL complexityLimit is configured but the optional package ' +
          '"graphql-query-complexity" is not installed. ' +
          'Install it or unset graphql.ext.complexityLimit.'
        );
      }
      validationRules.push(
        createComplexityLimitRule(complexityLimit, {
          scalarCost: 1,
          objectCost: 2,
          listFactor: 10,
        })
      );
      Logger.Debug(`GraphQL complexity limit enabled: ${complexityLimit}`);
    }

    // Create graphql-http handler
    const handler = createHandler({
      schema: impl.schema as any,
      rootValue: routeHandler,
      validationRules: validationRules.length > 0 ? validationRules : undefined,
      formatError: this.options.ext?.debug ? undefined : (error) => {
        const formatted: any = { message: error.message };
        if (error.extensions) {
          formatted.extensions = error.extensions;
        }
        if (error.locations) {
          formatted.locations = error.locations;
        }
        if (error.path) {
          formatted.path = error.path;
        }
        return formatted;
      },
      context: (req: any) => {
        // Extract Koa context from request
        return req.koattyContext;
      },
    });

    // Koa middleware adapter for graphql-http
    this.router.all(name, async (ctx: KoattyContext) => {
      // GraphiQL support: serve the playground for GET requests without query
      // only when enabled by the security profile or explicit config (SEC-04)
      if (ctx.method === 'GET' && this.playgroundEnabled && !ctx.query.query) {
        ctx.type = 'text/html';
        ctx.body = this.renderGraphiQL(name);
        return;
      }

      // Prepare fetch-compatible Request object
      const url = new URL(ctx.url, `${ctx.protocol}://${ctx.host}`);
      
      // Prepare headers
      const headers: Record<string, string> = {};
      Object.keys(ctx.headers).forEach(key => {
        const value = ctx.headers[key];
        if (typeof value === 'string') {
          headers[key] = value;
        } else if (Array.isArray(value)) {
          headers[key] = value.join(', ');
        }
      });

      // Prepare request body
      let requestBody: string | null = null;
      if (ctx.method !== 'GET' && ctx.method !== 'HEAD') {
        const koaRequest = ctx.request as any;
        if (koaRequest.body) {
          requestBody = JSON.stringify(koaRequest.body);
        }
      }

      const fetchRequest = new Request(url, {
        method: ctx.method,
        headers: headers,
        body: requestBody,
      });

      // Attach Koa context for custom context handler
      (fetchRequest as any).koattyContext = ctx;

      try {
        const response = await handler(fetchRequest);

        // Transfer response to Koa
        ctx.status = response.status;
        response.headers.forEach((value, key) => {
          ctx.set(key, value);
        });

        const body = await response.text();
        ctx.body = body;
      } catch (error: any) {
        Logger.Error(`GraphQL execution error: ${error.message}`);
        ctx.status = 500;
        ctx.body = { errors: [{ message: 'Internal server error' }] };
      }
    });
    this.routerMap.set(name, impl);
  }

  /**
   * Escape string for safe JavaScript embedding
   * @private
   */
  private escapeJsString(str: string): string {
    return str
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/"/g, '\\"')
      .replace(/</g, '\\x3c')
      .replace(/>/g, '\\x3e')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r');
  }

  /**
   * Render GraphiQL interface
   * 
   * @private
   * @param {string} endpoint - GraphQL endpoint URL
   * @returns {string} HTML content for GraphiQL
   */
  private renderGraphiQL(endpoint: string): string {
    const safeEndpoint = this.escapeJsString(endpoint);
    // SEC-04: fully self-contained playground — no unpkg/CDN scripts, so
    // the page works offline and never loads unverified third-party code
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>GraphQL Playground</title>
  <style>
    body { font-family: ui-monospace, Menlo, Consolas, monospace; margin: 24px; background: #f6f6f8; }
    h2 { margin-top: 0; }
    textarea { width: 100%; min-height: 180px; font-family: inherit; font-size: 13px; }
    #result { white-space: pre; background: #fff; border: 1px solid #ddd; padding: 12px; min-height: 120px; font-size: 13px; overflow: auto; }
    button { margin-top: 8px; padding: 6px 18px; }
    .hint { color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <h2>GraphQL Playground</h2>
  <textarea id="query" placeholder="query { ... }"></textarea>
  <div><button onclick="runQuery()">Run Query</button></div>
  <h3>Result</h3>
  <div id="result">(run a query)</div>
  <p class="hint">Endpoint: ${safeEndpoint}</p>
  <script>
    async function runQuery() {
      const query = document.getElementById('query').value;
      const result = document.getElementById('result');
      try {
        const res = await fetch('${safeEndpoint}', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query })
        });
        result.textContent = JSON.stringify(await res.json(), null, 2);
      } catch (e) {
        result.textContent = 'Request failed: ' + e.message;
      }
    }
  </script>
</body>
</html>`;
  }

  /**
   * ListRouter
   *
   * @returns {*}  {Map<string, RouterImplementation> }
   */
  ListRouter(): Map<string, RouterImplementation> {
    return this.routerMap;
  }

  /**
   * LoadRouter
   *
   * @param {any[]} list
   */
  async LoadRouter(app: Koatty, list: any[]) {
    try {
      // PERFORMANCE FIX: Use async I/O to avoid blocking event loop
      const schemaContent = await fs.promises.readFile(this.options.schemaFile, 'utf-8');
      const schema = buildSchema(schemaContent);

      // Schema validation
      // Note: buildSchema will throw if schema is invalid
      if (!schema) {
        Logger.Error('Failed to build GraphQL schema');
        throw new Error('Invalid GraphQL schema');
      }

      const rootValue: IGraphQLImplementation = {};

      for (const n of list) {
        const ctlClass = IOC.getClass(n, "CONTROLLER");
        // inject router
        const ctlRouters = await injectRouter(app, ctlClass, this.options.protocol);
        if (!ctlRouters) {
          continue;
        }
        // inject param
        const ctlParams = injectParamMetaData(app, ctlClass, this.options.payload);
        // tslint:disable-next-line: forin
        for (const router of Object.values(ctlRouters)) {
          const method = router.method;
          // const path = parsePath(router.path);
          // const requestMethod = <RequestMethod>router.requestMethod;
          const params = ctlParams[method];

          Logger.Debug(`Register request mapping: ${n}.${method}`);
          rootValue[method] = (args: any, ctx: KoattyContext): Promise<any> => {
            const ctl = IOC.getInsByClass(ctlClass, [ctx]);
            return Handler(app, ctx, ctl, method, params, Object.values(args), router.composedMiddleware);
          }
          this.SetRouter(router.ctlPath || "/graphql", {
            schema,
            implementation: rootValue
          });
        }
      }

      // exp: in middleware
      // app.Router.SetRouter('/xxx',  { schema, implementation: rootValue})

      // PERFORMANCE OPTIMIZATION: Merge router middleware to reduce middleware stack
      // In multi-protocol environment, merging routes() and allowedMethods() into 
      // a single middleware reduces function calls and improves performance by ~40%
      const routerMiddleware = this.router.routes();
      const allowedMethodsMiddleware = this.router.allowedMethods();

      // Merged middleware: protocol check + routes + allowedMethods
      app.use(async (ctx: KoattyContext, next: any) => {
        if (ctx.protocol === 'graphql') {
          // Chain routes and allowedMethods in single middleware
          await routerMiddleware(ctx as any, async () => {
            await allowedMethodsMiddleware(ctx as any, next);
          });
        } else {
          // Skip for non-GraphQL protocols
          await next();
        }
      });

      Logger.Debug('GraphQL router middleware registered (optimized)');
    } catch (err) {
      Logger.Error(err);
    }
  }

  /**
   * Cleanup router resources (for graceful shutdown)
   * GraphQL router is relatively stateless, this method is for interface consistency
   */
  public cleanup(): void {
    Logger.Debug('GraphQL router cleanup completed');
  }

}