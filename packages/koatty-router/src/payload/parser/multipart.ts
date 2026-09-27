/*
 * @Description: Payload parsing utilities with performance optimizations
 * @Usage: Parse request body based on content-type with caching
 * @Author: richen
 * @Date: 2023-12-09 12:02:29
 * @LastEditTime: 2025-01-20 10:00:00
 * @License: BSD (3-Clause)
 * @Copyright (c): <richenlin(at)gmail.com>
 */

import { existsSync, mkdirSync } from "fs";
import os from "os";
import path from "path";
import { DefaultLogger as Logger } from "koatty_logger";
import { KoattyContext } from "koatty_core";
import { PayloadOptions, FILE_KEY } from "../interface";
import { BufferEncoding, IncomingForm } from "formidable";
import onFinished from "on-finished";
import { deleteFiles } from "../../utils/path";
import { emptyFallback, multipartErrorStatus, payloadParseError, resolveOnParseError } from "../error_policy";
import { parseSize } from "../size";

/** Fail-closed fallbacks when no application security profile is reachable */
const DEFAULT_MAX_FILES = 10;
const DEFAULT_MAX_FIELDS = 100;
const DEFAULT_MAX_FIELDS_SIZE = '1mb';
const DEFAULT_FILE_SIZE = '1mb';

/**
 * Resolve multipart limits: explicit options win, then the application
 * security profile (`app.security.payload`), then fail-closed defaults.
 */
function resolveLimits(ctx: KoattyContext, opts: PayloadOptions) {
  let profile: any;
  try {
    profile = (ctx?.app as any)?.security?.payload;
  } catch {
    profile = undefined;
  }
  return {
    maxFileSize: parseSize(opts.limit, parseSize(profile?.limit, parseSize(DEFAULT_FILE_SIZE, 1024 * 1024))),
    maxFiles: opts.maxFiles ?? profile?.maxFiles ?? DEFAULT_MAX_FILES,
    maxFields: opts.maxFields ?? profile?.maxFields ?? DEFAULT_MAX_FIELDS,
    maxFieldsSize: parseSize(opts.maxFieldsSize ?? profile?.maxFieldsSize, parseSize(DEFAULT_MAX_FIELDS_SIZE, 1024 * 1024)),
  };
}

/**
 * Parse multipart/form-data request payload
 *
 * Hardened per SEC-05 / SEC-02:
 * - upload limits default from the application security profile
 *   (maxFileSize / maxFiles / maxFields / maxFieldsSize);
 * - `keepExtensions` defaults to false (never keep attacker-controlled
 *   extensions);
 * - temp files are cleaned on response finish (including error paths);
 * - parse failures throw an Exception with HTTP status 400/413 unless
 *   `onParseError: 'empty'` is requested.
 *
 * @param ctx KoattyContext - The Koatty context object
 * @param opts PayloadOptions - Configuration options for parsing
 * @returns Promise<Record<string, any>> - Resolves with parsed fields; files accessible via [FILE_KEY]
 *
 * @example
 * const result = await parseMultipart(ctx, {
 *   encoding: 'utf-8',
 *   multiples: true,
 *   limit: '20mb',
 * });
 * const files = result[FILE_KEY];
 *
 * // `originalFilename` is attacker-controlled: sanitize it before saving
 * import { safeFilename } from "../payload/size";
 * const safe = safeFilename(file.originalFilename);
 */
export function parseMultipart(ctx: KoattyContext, opts: PayloadOptions) {
  const limits = resolveLimits(ctx, opts);
  const uploadDir = opts.uploadDir ?? path.join(os.tmpdir(), `koatty-upload-${process.pid}`);
  // formidable writes files immediately once the stream starts; the directory
  // must exist before the form is constructed (synchronous to avoid a race)
  try {
    if (!existsSync(uploadDir)) mkdirSync(uploadDir, { recursive: true });
  } catch {
    // fall back to formidable's default upload directory
  }

  const formOptions: Record<string, unknown> = {
    encoding: <BufferEncoding>opts.encoding,
    multiples: opts.multiples,
    keepExtensions: opts.keepExtensions === true,
    maxFileSize: limits.maxFileSize,
    maxFiles: limits.maxFiles,
    maxFields: limits.maxFields,
    maxFieldsSize: limits.maxFieldsSize,
    uploadDir,
  };
  // NB: `filter` must only be set when actually provided — overriding
  // formidable's default filter with `undefined` breaks parsing entirely
  if (opts.fileFilter) {
    formOptions.filter = opts.fileFilter;
  }
  const form = new IncomingForm(formOptions as any);

  let uploadFiles: any = null;
  const cleanup = () => {
    if (uploadFiles) {
      try {
        deleteFiles(uploadFiles);
      } catch (e) {
        Logger.Error('[FileCleanupError]', e);
      }
    }
  };
  onFinished(ctx.res, cleanup);

  return new Promise((resolve, reject) => {
    form.parse(ctx.req, (err, fields, files) => {
      if (err) {
        uploadFiles = files;
        cleanup();
        if (resolveOnParseError(ctx, opts) === 'empty') {
          Logger.Warn('[MultipartParseError]', err);
          return resolve(emptyFallback('multipart body', err));
        }
        return reject(payloadParseError('multipart body', multipartErrorStatus(err), err));
      }

      uploadFiles = files;
      resolve({ ...fields, [FILE_KEY]: files });
    });
  });
}
