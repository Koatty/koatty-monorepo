/*
 * @Description: 
 * @Usage: 
 * @Author: richen
 * @Date: 2024-01-07 22:33:25
 * @LastEditTime: 2024-11-07 11:00:23
 * @License: BSD (3-Clause)
 * @Copyright (c): <richenlin(at)gmail.com>
 */
import { promises as fsPromise } from "fs";
import { DefaultLogger as logger } from "koatty_logger";

/**
 * @description: 
 * @param {string} path
 * @return {*}
 */
export function parsePath(opath: string): string {
  let path = opath || "/";
  
  // Replace multiple consecutive slashes with single slash
  path = path.replace(/\/+/g, '/');
  
  // Remove trailing slash (except for root path)
  if (path.length > 1 && path.endsWith("/")) {
    path = path.slice(0, path.length - 1);
  }
  
  return path;
}

/**
 * Uploaded file descriptor produced by formidable.
 * `multiples: false` yields single objects, `multiples: true` yields arrays;
 * formidable v3 uses `filepath`, older shapes may expose `path` (SEC-05).
 */
type FormFile = { filepath?: string; path?: string };

/**
 * @description: Asynchronously delete uploaded temporary files.
 * Accepts both the flat `{ field: file }` and the multiples
 * `{ field: file[] }` shapes, so temp files are never leaked.
 * @param {Record} files
 * @return {*}
 */
export async function deleteFiles(files: Record<string, FormFile | FormFile[]>) {
  const list: FormFile[] = Object.values(files ?? {})
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .filter((f): f is FormFile => !!f && typeof f === 'object');

  await Promise.all(list.map(async (file) => {
    const filePath = file.filepath ?? file.path;
    if (!filePath) {
      return;
    }
    try {
      await fsPromise.unlink(filePath);
    } catch (error: any) {
      // already gone is fine; anything else is a real cleanup failure
      if (error?.code !== 'ENOENT') {
        logger.Error(error);
      }
    }
  }));
};