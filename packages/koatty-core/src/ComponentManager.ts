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
  AppEventArr,
  AppEvent,
  KoattyApplication,
} from './IApplication';

interface ComponentMeta {
  name: string;
  instance: IPlugin;
  options: IComponentOptions;
  scope: ComponentScope;
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

      const pluginConfig = this.app.config('plugin') || {};
      const configOptions = pluginConfig.config?.[identifier] || {};

      if (configOptions.enabled === false) {
        options.enabled = false;
      }

      if (options.enabled === false) {
        Logger.Warn(`Component ${identifier} is disabled`);
        continue;
      }

      const instance = IOC.getInsByClass(item.target);
      if (!implementsPluginInterface(instance)) {
        Logger.Warn(`Component ${identifier} does not implement IPlugin interface, skipping`);
        continue;
      }

      const events = getComponentEvents(item.target);

      const meta: ComponentMeta = {
        name: identifier,
        instance,
        options: { ...options, ...configOptions },
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
    const events = meta.events;
    const hasRunMethod = Helper.isFunction(meta.instance.run);
    const hasEventBindings = Object.keys(events).length > 0;

    let registeredCount = 0;

    // 规则1：如果有 @OnEvent 绑定，注册这些事件
    if (hasEventBindings) {
      for (const [eventName, methodNames] of Object.entries(events)) {
        if (!AppEventArr.includes(eventName)) {
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

    const pluginConfig = this.app.config('plugin') || {};
    const configList = pluginConfig.list || [];

    const loadOrder: string[] = [];
    const remaining = new Set(this.userComponents.keys());

    // 配置中指定的顺序优先
    for (const name of configList) {
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
}
