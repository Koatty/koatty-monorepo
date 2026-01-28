/*
 * @Description: Component manager for plugin system
 * @Usage:
 * @Author: richen
 * @Date: 2026-01-26 11:30:00
 * @LastEditTime: 2026-01-26 11:30:00
 * @License: BSD (3-Clause)
 * @Copyright (c): <richenlin(at)gmail.com>
 */

import { IOC } from "koatty_container";
import { Helper } from "koatty_lib";
import { DefaultLogger as Logger } from "koatty_logger";
import {
  IPlugin,
  IPluginOptions,
  IPluginDependency,
  IPluginCapability,
  PluginDependencyType,
  implementsPluginInterface,
  PLUGIN_OPTIONS
} from './Component';
import {
  AppEvent,
  AppEventArr,
  KoattyApplication,
  EventHookFunc
} from './IApplication';
import {
  PluginDependencyError,
  PluginConflictError,
  PluginContractError
} from './Errors';

interface PluginMeta {
  name: string;
  instance: IPlugin;
  options: IPluginOptions;
  type: 'user' | 'core';
  version?: string;
  dependencies: IPluginDependency[];
  provides: IPluginCapability[];
  conflicts: string[];
}

interface DependencyValidationResult {
  satisfied: boolean;
  missingDependencies: IPluginDependency[];
  conflicts: string[];
  contractErrors: Array<{
    dependency: IPluginDependency;
    reason: string;
  }>;
}

export class ComponentManager {
  private app: KoattyApplication;
  private userPlugins: Map<string, PluginMeta> = new Map();
  private corePlugins: Map<string, PluginMeta> = new Map();
  private registeredEvents: Set<string> = new Set();

  constructor(app: KoattyApplication) {
    this.app = app;
  }

  discoverPlugins(): void {
    const componentList = IOC.listClass("COMPONENT") || [];

    for (const item of componentList) {
      const identifier = (item.id ?? "").replace("COMPONENT:", "");

      if (!identifier.endsWith("Plugin")) {
        continue;
      }

      if (!identifier || !Helper.isClass(item.target)) {
        continue;
      }

      const pluginOptions = IOC.getPropertyData(PLUGIN_OPTIONS, item.target, identifier) || {};

      const options: IPluginOptions = {
        type: 'user',
        enabled: true,
        priority: 0,
        dependencies: [],
        provides: [],
        conflicts: [],
        ...pluginOptions
      };

      const pluginConfig = this.app.config('plugin') || {};
      const configOptions = pluginConfig.config?.[identifier] || {};

      if (configOptions.enabled === false) {
        options.enabled = false;
      }

      if (options.enabled === false) {
        Logger.Warn(`Plugin ${identifier} is registered but disabled`);
        continue;
      }

      const instance = IOC.getInsByClass(item.target);
      if (!implementsPluginInterface(instance)) {
        throw new Error(
          `Plugin ${identifier} must implement IPlugin interface (have run() or events)`
        );
      }

      const dependencies: IPluginDependency[] = [
        ...(instance.dependencies || []),
        ...(options.dependencies || [])
      ].map(dep => this.normalizeDependency(dep));

      const provides: IPluginCapability[] = [
        ...(instance.provides || []),
        ...(options.provides || [])
      ].map(cap => this.normalizeCapability(cap));

      const conflicts: string[] = [
        ...(instance.conflicts || []),
        ...(options.conflicts || [])
      ];

      const version = this.getPluginVersion(item.target);

      const meta: PluginMeta = {
        name: identifier,
        instance,
        options: { ...options, ...configOptions },
        type: options.type || 'user',
        version,
        dependencies,
        provides,
        conflicts,
      };

      if (meta.type === 'core') {
        this.corePlugins.set(identifier, meta);
        Logger.Log('Koatty', '', `✓ Discovered core plugin: ${identifier}${version ? ` v${version}` : ''}`);

        if (provides.length > 0) {
          Logger.Debug(`  Provides: ${provides.map(c => c.name).join(', ')}`);
        }

        if (dependencies.length > 0) {
          const depStr = dependencies.map(d => {
            const typeLabel = d.type === PluginDependencyType.REQUIRED ? '' :
                            d.type === PluginDependencyType.OPTIONAL ? '(optional)' : '(contract)';
            return `${d.name}${typeLabel}`;
          }).join(', ');
          Logger.Debug(`  Depends on: ${depStr}`);
        }
      } else {
        this.userPlugins.set(identifier, meta);
        Logger.Debug(`Discovered user plugin: ${identifier}`);
      }
    }
  }

  private getPluginVersion(target: any): string | undefined {
    try {
      const targetPath = target.prototype?.constructor?.toString() || '';
      return undefined;
    } catch {
      return undefined;
    }
  }

  private normalizeDependency(dep: string | IPluginDependency): IPluginDependency {
    if (typeof dep === 'string') {
      return {
        name: dep,
        type: PluginDependencyType.REQUIRED,
      };
    }
    return dep;
  }

  private normalizeCapability(cap: string | IPluginCapability): IPluginCapability {
    if (typeof cap === 'string') {
      return {
        name: cap,
        version: '1.0.0',
      };
    }
    return cap;
  }

  private getAvailableCapabilities(): Map<string, IPluginCapability[]> {
    const capabilities = new Map<string, IPluginCapability[]>();

    for (const meta of this.corePlugins.values()) {
      for (const cap of meta.provides) {
        if (!capabilities.has(cap.name)) {
          capabilities.set(cap.name, []);
        }
        capabilities.get(cap.name)!.push(cap);
      }
    }

    return capabilities;
  }

  private checkContractDependency(
    dependency: IPluginDependency,
    app: KoattyApplication,
    capabilities: Map<string, IPluginCapability[]>
  ): { satisfied: boolean; reason?: string } {
    const providers = capabilities.get(dependency.name);

    if (!providers || providers.length === 0) {
      return {
        satisfied: false,
        reason: `No plugin provides capability '${dependency.name}'`
      };
    }

    if (dependency.validate) {
      try {
        const isValid = dependency.validate(app);
        if (!isValid) {
          return {
            satisfied: false,
            reason: `Contract validation failed for '${dependency.name}'`
          };
        }
      } catch (error) {
        return {
          satisfied: false,
          reason: `Contract validation error: ${error.message}`
        };
      }
    }

    return { satisfied: true };
  }

  private validatePluginDependencies(
    pluginName: string,
    meta: PluginMeta,
    capabilities: Map<string, IPluginCapability[]>
  ): DependencyValidationResult {
    const result: DependencyValidationResult = {
      satisfied: true,
      missingDependencies: [],
      conflicts: [],
      contractErrors: [],
    };

    for (const dep of meta.dependencies) {
      switch (dep.type) {
        case PluginDependencyType.REQUIRED:
          if (!this.corePlugins.has(dep.name)) {
            result.satisfied = false;
            result.missingDependencies.push(dep);
          }
          break;

        case PluginDependencyType.OPTIONAL:
          if (!this.corePlugins.has(dep.name)) {
            Logger.Warn(
              `Plugin ${pluginName} has optional dependency ${dep.name} which is not available`
            );
          }
          break;

        case PluginDependencyType.CONTRACT:
          const contractCheck = this.checkContractDependency(dep, this.app, capabilities);
          if (!contractCheck.satisfied) {
            result.satisfied = false;
            result.contractErrors.push({
              dependency: dep,
              reason: contractCheck.reason!,
            });
          }
          break;
      }
    }

    for (const conflictPlugin of meta.conflicts) {
      if (this.corePlugins.has(conflictPlugin)) {
        result.satisfied = false;
        result.conflicts.push(conflictPlugin);
      }
    }

    return result;
  }

  private checkCoreDependencies(): void {
    const capabilities = this.getAvailableCapabilities();
    const errors: string[] = [];

    for (const [name, meta] of this.corePlugins) {
      const validation = this.validatePluginDependencies(name, meta, capabilities);

      if (!validation.satisfied) {
        const errorMessages: string[] = [];

        if (validation.missingDependencies.length > 0) {
          for (const dep of validation.missingDependencies) {
            const message = dep.errorMessage ||
              `Plugin '${name}' requires plugin '${dep.name}' but it is not registered or is disabled`;
            errorMessages.push(message);

            errorMessages.push(
              `  → Solution: Enable '${dep.name}' in config/plugin.ts or remove dependency from '${name}'`
            );
          }
        }

        if (validation.contractErrors.length > 0) {
          for (const err of validation.contractErrors) {
            const message = err.dependency.errorMessage ||
              `Plugin '${name}' requires capability '${err.dependency.name}' but it is not satisfied`;
            errorMessages.push(`${message}: ${err.reason}`);

            errorMessages.push(
              `  → Solution: Enable a plugin that provides '${err.dependency.name}' capability`
            );
          }
        }

        if (validation.conflicts.length > 0) {
          for (const conflict of validation.conflicts) {
            errorMessages.push(
              `Plugin '${name}' conflicts with plugin '${conflict}'`
            );
            errorMessages.push(
              `  → Solution: Disable either '${name}' or '${conflict}' in config/plugin.ts`
            );
          }
        }

        errors.push(...errorMessages);
      }
    }

    if (errors.length > 0) {
      const errorMessage = [
        '╔════════════════════════════════════════════════════════════════╗',
        '║            Plugin Dependency Validation Failed                 ║',
        '╚════════════════════════════════════════════════════════════════╝',
        '',
        ...errors,
        '',
        'Please fix the above issues and restart the application.',
      ].join('\n');

      throw new Error(errorMessage);
    }
  }

  private resolveCorePluginOrder(): string[] {
    const order: string[] = [];
    const visiting = new Set<string>();
    const visited = new Set<string>();

    const visit = (name: string) => {
      if (visited.has(name)) return;
      if (visiting.has(name)) {
        throw new Error(`Circular dependency detected for core plugin: ${name}`);
      }

      visiting.add(name);

      const plugin = this.corePlugins.get(name);
      if (!plugin) return;

      const deps = plugin.instance.dependencies || plugin.options.dependencies || [];
      for (const dep of deps) {
        const depName = typeof dep === 'string' ? dep : dep.name;
        visit(depName);
      }

      visiting.delete(name);
      visited.add(name);
      order.push(name);
    };

    for (const name of this.corePlugins.keys()) {
      visit(name);
    }

    return order;
  }

  registerCorePluginHooks(): void {
    Logger.Log('Koatty', '', '============ Registering Core Plugin Hooks ============');

    this.checkCoreDependencies();

    const pluginOrder = this.resolveCorePluginOrder();

    Logger.Log('Koatty', '', `Core plugin order: ${pluginOrder.join(' -> ')}`);

    for (const name of pluginOrder) {
      const meta = this.corePlugins.get(name)!;

      const events = meta.instance.events || meta.options.events || {};

      if (Object.keys(events).length === 0) {
        Logger.Warn(`Core plugin ${name} has no event hooks defined`);
        continue;
      }

      let registeredCount = 0;

      for (const [eventName, handler] of Object.entries(events)) {
        if (!AppEventArr.includes(eventName)) {
          Logger.Warn(`Core plugin ${name} registers unknown event: ${eventName}`);
          continue;
        }

        if (!Helper.isFunction(handler)) {
          Logger.Warn(`Core plugin ${name} event handler for ${eventName} is not a function`);
          continue;
        }

        const wrappedHandler = async () => {
          try {
            Logger.Debug(`[${name}] Handling event: ${eventName}`);
            await handler(this.app);
          } catch (error) {
            Logger.Error(`[${name}] Error handling event ${eventName}:`, error);
            throw error;
          }
        };

        this.app.once(eventName, wrappedHandler);
        registeredCount++;

        this.registeredEvents.add(`${name}:${eventName}`);
      }

      Logger.Log('Koatty', '', `✓ Core plugin ${name} registered ${registeredCount} event hooks`);
    }

    Logger.Log('Koatty', '', '============ Core Plugin Hooks Registered ============');
  }

  async loadUserPlugins(): Promise<string[]> {
    Logger.Log('Koatty', '', '============ Loading User Plugins ============');

    const pluginConfig = this.app.config('plugin') || {};
    const configList = pluginConfig.list || [];

    const loadOrder: string[] = [];
    const remaining = new Set(this.userPlugins.keys());

    for (const name of configList) {
      if (this.userPlugins.has(name)) {
        loadOrder.push(name);
        remaining.delete(name);
      }
    }

    const remainingPlugins = Array.from(remaining)
      .map(name => ({
        name,
        priority: this.userPlugins.get(name)!.options.priority || 0
      }))
      .sort((a, b) => b.priority - a.priority)
      .map(p => p.name);

    loadOrder.push(...remainingPlugins);

    const loaded: string[] = [];

    for (const name of loadOrder) {
      const meta = this.userPlugins.get(name);
      if (!meta) continue;

      if (!Helper.isFunction(meta.instance.run)) {
        Logger.Warn(`User plugin ${name} missing run() method, skipping`);
        continue;
      }

      try {
        Logger.Log('Koatty', '', `Loading user plugin: ${name}`);

        await meta.instance.run(meta.options, this.app);
        loaded.push(name);

        Logger.Log('Koatty', '', `✓ User plugin ${name} loaded`);
      } catch (error) {
        Logger.Error(`Failed to load user plugin ${name}:`, error);
        throw error;
      }
    }

    Logger.Log('Koatty', '', `============ Loaded ${loaded.length} User Plugins ============`);

    return loaded;
  }

  async unloadPlugins(): Promise<void> {
    Logger.Log('Koatty', '', 'Unloading plugins...');

    for (const [name, meta] of this.userPlugins) {
      if (!meta.instance.uninstall) continue;

      try {
        Logger.Debug(`Unloading user plugin: ${name}`);
        await meta.instance.uninstall(this.app);
      } catch (error) {
        Logger.Warn(`Failed to unload user plugin ${name}:`, error);
      }
    }

    for (const [name, meta] of this.corePlugins) {
      if (!meta.instance.uninstall) continue;

      try {
        Logger.Debug(`Unloading core plugin: ${name}`);
        await meta.instance.uninstall(this.app);
      } catch (error) {
        Logger.Warn(`Failed to unload core plugin ${name}:`, error);
      }
    }

    this.corePlugins.clear();
    this.userPlugins.clear();
    this.registeredEvents.clear();
  }

  getPlugin<T = IPlugin>(name: string): T | undefined {
    const meta = this.corePlugins.get(name) || this.userPlugins.get(name);
    return meta?.instance as T;
  }

  hasPlugin(name: string): boolean {
    return this.corePlugins.has(name) || this.userPlugins.has(name);
  }

  getStats() {
    return {
      corePlugins: this.corePlugins.size,
      userPlugins: this.userPlugins.size,
      totalPlugins: this.corePlugins.size + this.userPlugins.size,
      registeredEvents: this.registeredEvents.size,
    };
  }
}
