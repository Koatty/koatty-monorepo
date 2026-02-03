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
  IComponentOptions,
  ComponentScope,
  COMPONENT_OPTIONS,
  getComponentEvents,
  implementsPluginInterface,
  PLUGIN_OPTIONS
} from './Component';
import {
  AppEvent,
  KoattyApplication,
} from './IApplication';

/**
 * Component metadata structure
 * Contains all information about a registered component
 */
export interface ComponentMeta {
  /** Unique component name/identifier */
  name: string;
  /** Component instance (lazy-loaded) */
  instance: IPlugin | null;
  /** Component class reference */
  target?: any;
  /** Component configuration options */
  options: IComponentOptions;
  /** Component scope: 'core' or 'user' */
  scope: ComponentScope;
  /** Event bindings from @OnEvent decorators */
  events: Record<string, string[]>;
}

export class ComponentManager {
  private app: KoattyApplication;
  private coreComponents: Map<string, ComponentMeta> = new Map();
  private userComponents: Map<string, ComponentMeta> = new Map();
  private registeredEvents: Set<string> = new Set();

  constructor(app: KoattyApplication) {
    this.app = app;
  }

  /**
   * Register App class event handlers.
   * App class is manually registered with type 'COMPONENT' in Bootstrap.
   * This method loads its @OnEvent decorated methods.
   * 
   * @param target The App class
   */
  registerAppEvents(target: any): void {
    const instance = IOC.getInsByClass(target);
    if (!instance) {
      Logger.Warn('App instance not found in IOC');
      return;
    }

    const events = getComponentEvents(target);
    if (Object.keys(events).length === 0) {
      Logger.Debug('App class has no @OnEvent decorators');
      return;
    }

    const meta: ComponentMeta = {
      name: target.name || 'App',
      instance,
      options: { enabled: true, priority: 0, scope: 'core' as const },
      scope: 'core',
      events,
    };

    this.registerComponentEvents(meta.name, meta);
  }

  discoverComponents(): void {
    const componentList = IOC.listClass("COMPONENT") || [];

    for (const item of componentList) {
      const identifier = (item.id ?? "").replace("COMPONENT:", "");

      // Check if the class is marked as COMPONENT type instead of using suffix
      const componentType = IOC.getType(item.target);

      if (componentType !== 'COMPONENT') {
        continue;
      }

      if (!identifier || !Helper.isClass(item.target)) {
        continue;
      }

      let options: IComponentOptions = IOC.getPropertyData(
        COMPONENT_OPTIONS, item.target, identifier
      );

      if (!options) {
        options = IOC.getPropertyData(PLUGIN_OPTIONS, item.target, identifier);
      }

      options = options || { enabled: true, priority: 0, scope: 'user' };

      const pluginConfig = this.app.config('config', 'plugin') || {};
      const configOptions = pluginConfig?.[identifier] || {};

      // Merge config options
      options = { ...options, ...configOptions };

      // Determine if component should be enabled
      let shouldEnable = true;
      
      if (options.scope === 'core') {
        // Core components: enabled by default unless explicitly disabled
        shouldEnable = options.enabled !== false;
      } else {
        // User components: backward compatibility - enable if in list OR config.enabled=true
        const pluginList = this.app.config('list', 'plugin') || [];
        const isInList = pluginList.includes(identifier);
        const isEnabledInConfig = options.enabled !== false;
        shouldEnable = isInList || isEnabledInConfig;
      }

      if (!shouldEnable) {
        Logger.Warn(`Component ${identifier} is disabled`);
        continue;
      }

      // Ensure enabled is true
      options.enabled = true;

      const events = getComponentEvents(item.target);
      
      // Check if component has @OnEvent bindings or could have run() method
      const hasEventBindings = Object.keys(events).length > 0;
      
      if (!hasEventBindings) {
        // If no @OnEvent, check if it might have a run() method
        // We defer checking run() until instance is created during registration
        const instance = IOC.getInsByClass(item.target);
        const hasRunMethod = implementsPluginInterface(instance);
        // Component has neither run() method nor @OnEvent bindings, skipping
        if (!hasRunMethod) {
          continue;
        }
      }

      // Store target class, instance will be retrieved during event registration
      const meta: ComponentMeta = {
        name: identifier,
        instance: null as any, // Will be set during registerComponentEvents
        target: item.target,   // Store target class
        options: options,
        scope: options.scope || 'user',
        events,
      };

      if (meta.scope === 'core') {
        this.coreComponents.set(identifier, meta);
        Logger.Log('Koatty', '', `✓ Discovered core component: ${identifier}`);
      } else {
        this.userComponents.set(identifier, meta);
        Logger.Debug(`Discovered user component: ${identifier}`);
      }
    }
  }

  private checkDependencies(): void {
    const allComponents = new Set([
      ...this.coreComponents.keys(),
      ...this.userComponents.keys()
    ]);

    const checkComponent = (name: string, meta: ComponentMeta) => {
      const requires = meta.options.requires || [];
      for (const dep of requires) {
        if (!allComponents.has(dep)) {
          throw new Error(
            `Component '${name}' requires '${dep}' but it is not available.\n` +
            `  → Solution: Enable '${dep}' in config/plugin.ts`
          );
        }
      }
    };

    for (const [name, meta] of this.coreComponents) {
      checkComponent(name, meta);
    }

    for (const [name, meta] of this.userComponents) {
      checkComponent(name, meta);
    }
  }

  private sortByPriority(components: Map<string, ComponentMeta>): string[] {
    return Array.from(components.entries())
      .sort((a, b) => (b[1].options.priority || 0) - (a[1].options.priority || 0))
      .map(([name]) => name);
  }

  registerCoreComponentHooks(): void {
    Logger.Log('Koatty', '', '============ Registering Core Component Hooks ============');

    this.checkDependencies();

    const componentOrder = this.sortByPriority(this.coreComponents);
    Logger.Log('Koatty', '', `Core component order: ${componentOrder.join(' -> ')}`);

    for (const name of componentOrder) {
      const meta = this.coreComponents.get(name)!;
      this.registerComponentEvents(name, meta);
    }

    Logger.Log('Koatty', '', '============ Core Component Hooks Registered ============');
  }

  private registerComponentEvents(name: string, meta: ComponentMeta): void {
    // Get or create instance if not already set
    if (!meta.instance && meta.target) {
      meta.instance = IOC.getInsByClass(meta.target);
    }
    
    if (!meta.instance) {
      Logger.Warn(`Component ${name} instance not found, skipping event registration`);
      return;
    }
    
    const events = meta.events;
    const hasRunMethod = Helper.isFunction(meta.instance.run);
    const hasEventBindings = Object.keys(events).length > 0;

    let registeredCount = 0;

    // 规则1：如果有 @OnEvent 绑定，注册这些事件
    if (hasEventBindings) {
      const appEventArr = Object.values(AppEvent);
      for (const [eventName, methodNames] of Object.entries(events)) {
        if (!appEventArr.includes(eventName as AppEvent)) {
          Logger.Warn(`Component ${name} registers unknown event: ${eventName}`);
          continue;
        }

        for (const methodName of methodNames) {
          const handler = (meta.instance as any)[methodName];
          if (!Helper.isFunction(handler)) {
            Logger.Warn(`Component ${name} event handler ${methodName} is not a function`);
            continue;
          }

          const wrappedHandler = async () => {
            try {
              Logger.Debug(`[${name}] Handling event: ${eventName} via ${String(methodName)}`);
              await handler.call(meta.instance, this.app);
            } catch (error) {
              Logger.Error(`[${name}] Error handling event ${eventName}:`, error);
              throw error;
            }
          };

          this.app.once(eventName, wrappedHandler);
          registeredCount++;
          this.registeredEvents.add(`${name}:${eventName}`);
        }
      }
    }

    // 规则2：如果有 run 方法，检查是否需要默认绑定
    if (hasRunMethod) {
      // 检查 run 是否已经被 @OnEvent 标记
      const runAlreadyBound = Object.values(events).some(
        methods => methods.includes('run')
      );

      // 如果 run 没有被 @OnEvent 标记，绑定到默认事件
      if (!runAlreadyBound) {
        const defaultEvent = AppEvent.appReady;
        Logger.Debug(`Component ${name}.run() auto-binds to ${defaultEvent}`);
        this.bindRunMethod(name, meta, defaultEvent);
      }
    }

    if (registeredCount > 0) {
      Logger.Log('Koatty', '', `✓ Component ${name} registered ${registeredCount} event hooks`);
    }
  }

  /**
   * 绑定 run 方法到指定事件
   */
  private bindRunMethod(name: string, meta: ComponentMeta, eventName: string): void {
    const wrappedHandler = async () => {
      try {
        Logger.Debug(`[${name}] Executing run() on ${eventName}`);
        await meta.instance.run!(meta.options, this.app);
      } catch (error) {
        Logger.Error(`[${name}] Error in run():`, error);
        throw error;
      }
    };

    this.app.once(eventName, wrappedHandler);
    this.registeredEvents.add(`${name}:${eventName}:run`);
  }

  async loadUserComponents(): Promise<string[]> {
    Logger.Log('Koatty', '', '============ Loading User Components ============');

    const pluginList = this.app.config('list', 'plugin') || [];

    const loadOrder: string[] = [];
    const remaining = new Set(this.userComponents.keys());

    // 配置中指定的顺序优先
    for (const name of pluginList) {
      if (this.userComponents.has(name)) {
        loadOrder.push(name);
        remaining.delete(name);
      }
    }

    // 剩余的按优先级排序
    const remainingOrder = this.sortByPriority(
      new Map(Array.from(remaining).map(n => [n, this.userComponents.get(n)!]))
    );
    loadOrder.push(...remainingOrder);

    const loaded: string[] = [];

    for (const name of loadOrder) {
      const meta = this.userComponents.get(name);
      if (!meta) continue;

      // 注册事件（包括 run 方法的默认绑定）
      this.registerComponentEvents(name, meta);

      // 检查是否有需要手动执行的初始化逻辑
      // 如果组件只有 @OnEvent 绑定，不需要额外调用 run
      // 如果组件有 run 方法，已经被 registerComponentEvents 自动绑定到 appReady
      const hasEventBindings = Object.keys(meta.events).length > 0;
      const hasRunMethod = Helper.isFunction(meta.instance.run);

      if (!hasEventBindings && hasRunMethod) {
        try {
          Logger.Log('Koatty', '', `Loading user component: ${name}`);
          await meta.instance.run(meta.options, this.app);
          loaded.push(name);
          Logger.Log('Koatty', '', `✓ User component ${name} loaded`);
        } catch (error) {
          Logger.Error(`Failed to load user component ${name}:`, error);
          throw error;
        }
      } else if (hasEventBindings) {
        // 有事件绑定，自动处理
        loaded.push(name);
      }
    }

    Logger.Log('Koatty', '', `============ Loaded ${loaded.length} User Components ============`);
    return loaded;
  }

  async unloadComponents(): Promise<void> {
    Logger.Log('Koatty', '', 'Unloading components...');

    this.coreComponents.clear();
    this.userComponents.clear();
    this.registeredEvents.clear();
  }

  getPlugin<T = IPlugin>(name: string): T | undefined {
    const meta = this.coreComponents.get(name) || this.userComponents.get(name);
    return meta?.instance as T;
  }

  hasPlugin(name: string): boolean {
    return this.coreComponents.has(name) || this.userComponents.has(name);
  }

  getStats() {
    return {
      coreComponents: this.coreComponents.size,
      userComponents: this.userComponents.size,
      totalComponents: this.coreComponents.size + this.userComponents.size,
      registeredEvents: this.registeredEvents.size,
    };
  }

  // ============================================================
  // Plugin Query API (unified management)
  // ============================================================

  /**
   * Get all registered components (both core and user)
   * @returns Array of component metadata
   */
  getAllComponents(): ComponentMeta[] {
    return [
      ...Array.from(this.coreComponents.values()),
      ...Array.from(this.userComponents.values()),
    ];
  }

  /**
   * Get all core components
   * @returns Array of core component metadata
   */
  getCoreComponents(): ComponentMeta[] {
    return Array.from(this.coreComponents.values());
  }

  /**
   * Get all user components
   * @returns Array of user component metadata
   */
  getUserComponents(): ComponentMeta[] {
    return Array.from(this.userComponents.values());
  }

  /**
   * Get component metadata by name
   * @param name Component name
   * @returns Component metadata or undefined
   */
  getComponent(name: string): ComponentMeta | undefined {
    return this.coreComponents.get(name) || this.userComponents.get(name);
  }

  /**
   * Get all components sorted by priority (higher priority first)
   * @returns Sorted array of component metadata
   */
  getComponentsSortedByPriority(): ComponentMeta[] {
    return this.getAllComponents()
      .sort((a, b) => (b.options.priority || 0) - (a.options.priority || 0));
  }

  /**
   * Get component names
   * @returns Array of component names
   */
  getComponentNames(): string[] {
    return [
      ...Array.from(this.coreComponents.keys()),
      ...Array.from(this.userComponents.keys()),
    ];
  }

  /**
   * Get components with version info (for debugging/monitoring)
   * @returns Array of component info objects
   */
  getComponentsInfo(): Array<{
    name: string;
    version?: string;
    description?: string;
    scope: ComponentScope;
    priority: number;
    enabled: boolean;
  }> {
    return this.getAllComponents().map(meta => ({
      name: meta.name,
      version: meta.options.version,
      description: meta.options.description,
      scope: meta.scope,
      priority: meta.options.priority || 0,
      enabled: meta.options.enabled !== false,
    }));
  }

  /**
   * Print component registry summary (for debugging)
   */
  printSummary(): void {
    const info = this.getComponentsInfo();
    Logger.Log('Koatty', '', '============ Component Registry Summary ============');
    Logger.Log('Koatty', '', `Total: ${info.length} components`);
    
    const coreInfo = info.filter(i => i.scope === 'core');
    const userInfo = info.filter(i => i.scope === 'user');
    
    if (coreInfo.length > 0) {
      Logger.Log('Koatty', '', `Core Components (${coreInfo.length}):`);
      for (const c of coreInfo) {
        const ver = c.version ? ` v${c.version}` : '';
        const desc = c.description ? ` - ${c.description}` : '';
        Logger.Log('Koatty', '', `  ✓ ${c.name}${ver}${desc}`);
      }
    }
    
    if (userInfo.length > 0) {
      Logger.Log('Koatty', '', `User Components (${userInfo.length}):`);
      for (const c of userInfo) {
        const ver = c.version ? ` v${c.version}` : '';
        Logger.Log('Koatty', '', `  • ${c.name}${ver}`);
      }
    }
    
    Logger.Log('Koatty', '', '====================================================');
  }
}
