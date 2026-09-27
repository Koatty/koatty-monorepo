/*
 * @Description: 
 * @Usage: 
 * @Author: richen
 * @Date: 2023-12-09 12:02:29
 * @LastEditTime: 2025-03-15 22:21:29
 * @License: BSD (3-Clause)
 * @Copyright (c): <richenlin(at)gmail.com>
 */

/**
 * 请求参数选项
 */
export interface PayloadOptions {
  extTypes: Record<string, string[]>;
  limit: string;
  encoding: BufferEncoding;
  multiples: boolean;
  keepExtensions: boolean;
  length?: number;
  /**
   * Behavior when the request body cannot be parsed (SEC-02 / ADR-101):
   * - 'reject' (default): throw an Exception carrying the HTTP status
   *   (400 malformed, 413 too large, 415 unsupported encoding);
   * - 'empty': legacy behavior, log and fall back to `{}`.
   * When unset, falls back to `app.security.payload.onParseError`.
   */
  onParseError?: 'reject' | 'empty';
  /**
   * Protocol Buffer 文件路径（用于 gRPC 自动解析）
   * 如果提供，gRPC payload 解析器将尝试自动解码
   */
  protoFile?: string;
  /** Max number of uploaded files per request (multipart). Defaults from the security profile. */
  maxFiles?: number;
  /** Max number of form fields per request (multipart). Defaults from the security profile. */
  maxFields?: number;
  /** Max total size of non-file fields, e.g. '1mb' (multipart). Defaults from the security profile. */
  maxFieldsSize?: string;
  /** Directory for uploaded temp files. Defaults to `os.tmpdir()/koatty-upload-<pid>`. */
  uploadDir?: string;
  /** Optional formidable filter to accept/reject parts by mimetype or name. */
  fileFilter?: (part: unknown) => boolean | Promise<boolean>;
}

/**
 * Symbol key for uploaded files in parsed multipart body.
 * Use this key to access files from the parsed body object:
 * @example
 * const files = parsedBody[FILE_KEY];
 */
export const FILE_KEY = Symbol.for('koatty.files');