/**
 * Constants and defaults for the Koatty MCP host (roadmap Phase F, item F-1).
 * @License BSD-3-Clause
 */

/** Metadata key holding `@Tool` declarations (read through the IoC metadata store). */
export const MCP_TOOL_KEY = 'MCP_TOOL_KEY';
/** Metadata key holding `@Resource` declarations. */
export const MCP_RESOURCE_KEY = 'MCP_RESOURCE_KEY';
/** Metadata key holding `@Prompt` declarations. */
export const MCP_PROMPT_KEY = 'MCP_PROMPT_KEY';

/** Default mount path of the Streamable HTTP transport. */
export const MCP_DEFAULT_PATH = '/mcp';
/**
 * Local mode binds loopback by default (F-1, protocol safety). Exposing the MCP
 * endpoint publicly must be an explicit decision.
 */
export const MCP_DEFAULT_HOST = '127.0.0.1';
export const MCP_SERVER_NAME = 'koatty';
export const MCP_SERVER_VERSION = '1.0.0';

/** Marker for DTO fields/constraints the schema bridge could not resolve. */
export const MCP_UNRESOLVED_MARKER = 'x-koatty-unresolved';

/** Component types scanned for protocol metadata, in scan order. */
export const MCP_COMPONENT_TYPES = ['COMPONENT', 'SERVICE'];

/** Default approval timeout: a pending high-risk call is rejected after 5 minutes. */
export const MCP_APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;
