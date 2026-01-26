/*
 * @Description: Error classes for Koatty framework
 * @Usage:
 * @Author: richen
 * @Date: 2026-01-26 10:30:00
 * @LastEditTime: 2026-01-26 10:30:00
 * @License: BSD (3-Clause)
 * @Copyright (c): <richenlin(at)gmail.com>
 */

import { PluginDependencyType } from './Component';

export class PluginDependencyError extends Error {
  constructor(
    public pluginName: string,
    public dependencyName: string,
    public dependencyType: PluginDependencyType,
    message?: string
  ) {
    super(message || `Plugin ${pluginName} depends on ${dependencyName}`);
    this.name = 'PluginDependencyError';
  }
}

export class PluginConflictError extends Error {
  constructor(
    public pluginName: string,
    public conflictPlugin: string,
    message?: string
  ) {
    super(message || `Plugin ${pluginName} conflicts with ${conflictPlugin}`);
    this.name = 'PluginConflictError';
  }
}

export class PluginContractError extends Error {
  constructor(
    public pluginName: string,
    public contractName: string,
    message?: string
  ) {
    super(message || `Plugin ${pluginName} requires contract ${contractName}`);
    this.name = 'PluginContractError';
  }
}
