/*
 * @Description: Utils Tests
 * @Usage: Test utility functions
 * @Author: richen
 * @Date: 2025-01-20 10:00:00
 * @LastEditTime: 2025-01-20 10:00:00
 * @License: BSD (3-Clause)
 * @Copyright (c): <richenlin(at)gmail.com>
 */

import { parsePath, deleteFiles } from '../src/utils/path';
import { promises as fsPromise } from 'fs';

// Mock dependencies
jest.mock('fs', () => ({
  promises: {
    access: jest.fn(),
    unlink: jest.fn(),
  }
}));

jest.mock('koatty_logger', () => ({
  DefaultLogger: {
    Error: jest.fn(),
  }
}));

const mockFsPromise = fsPromise as jest.Mocked<typeof fsPromise>;
const mockLogger = require('koatty_logger').DefaultLogger;

describe('Utils - Path Functions', () => {
  describe('parsePath', () => {
    it('should return root path when path is empty', () => {
      expect(parsePath('')).toBe('/');
    });

    it('should return root path when path is undefined', () => {
      expect(parsePath(undefined as any)).toBe('/');
    });

    it('should return root path when path is null', () => {
      expect(parsePath(null as any)).toBe('/');
    });

    it('should preserve single slash root path', () => {
      expect(parsePath('/')).toBe('/');
    });

    it('should preserve simple paths without trailing slash', () => {
      expect(parsePath('/api')).toBe('/api');
      expect(parsePath('/users')).toBe('/users');
      expect(parsePath('/api/v1')).toBe('/api/v1');
    });

    it('should remove trailing slash from paths', () => {
      expect(parsePath('/api/')).toBe('/api');
      expect(parsePath('/users/')).toBe('/users');
      expect(parsePath('/api/v1/')).toBe('/api/v1');
    });

    it('should remove multiple trailing slashes', () => {
      expect(parsePath('/api//')).toBe('/api');
      expect(parsePath('/users///')).toBe('/users');
    });

    it('should handle paths with double slashes in middle', () => {
      expect(parsePath('/api//users')).toBe('/api/users');
      expect(parsePath('/api///users//groups')).toBe('/api/users/groups');
    });

    it('should handle complex paths with multiple issues', () => {
      expect(parsePath('/api//users///')).toBe('/api/users');
      expect(parsePath('//api//users//')).toBe('/api/users');
    });

    it('should handle paths starting without slash', () => {
      expect(parsePath('api')).toBe('api');
      expect(parsePath('api/users')).toBe('api/users');
    });

    it('should handle very short paths', () => {
      expect(parsePath('/a')).toBe('/a');
      expect(parsePath('/a/')).toBe('/a');
    });

    it('should handle empty string correctly', () => {
      expect(parsePath('')).toBe('/');
    });

    it('should preserve path parameters and query strings', () => {
      expect(parsePath('/users/:id')).toBe('/users/:id');
      expect(parsePath('/api/users/:id/')).toBe('/api/users/:id');
    });
  });

  describe('deleteFiles (SEC-05 semantics: direct unlink, array-aware, ENOENT tolerated)', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should delete a single file (legacy {path} shape) successfully', async () => {
      const files = {
        file1: { path: '/tmp/test1.txt' }
      };

      mockFsPromise.unlink.mockResolvedValue(undefined);

      await deleteFiles(files);

      expect(mockFsPromise.unlink).toHaveBeenCalledWith('/tmp/test1.txt');
      expect(mockLogger.Error).not.toHaveBeenCalled();
    });

    it('should delete files using formidable v3 {filepath} shape', async () => {
      const files = {
        file1: { filepath: '/tmp/test1.txt' },
        file2: { filepath: '/tmp/test2.txt' }
      };

      mockFsPromise.unlink.mockResolvedValue(undefined);

      await deleteFiles(files);

      expect(mockFsPromise.unlink).toHaveBeenCalledWith('/tmp/test1.txt');
      expect(mockFsPromise.unlink).toHaveBeenCalledWith('/tmp/test2.txt');
      expect(mockLogger.Error).not.toHaveBeenCalled();
    });

    it('should delete every file when a value is an array (multiples:true)', async () => {
      const files = {
        files: [
          { filepath: '/tmp/m1.txt' },
          { filepath: '/tmp/m2.txt' },
        ],
        single: { path: '/tmp/s1.txt' }
      };

      mockFsPromise.unlink.mockResolvedValue(undefined);

      await deleteFiles(files);

      expect(mockFsPromise.unlink).toHaveBeenCalledTimes(3);
      expect(mockFsPromise.unlink).toHaveBeenCalledWith('/tmp/m1.txt');
      expect(mockFsPromise.unlink).toHaveBeenCalledWith('/tmp/m2.txt');
      expect(mockFsPromise.unlink).toHaveBeenCalledWith('/tmp/s1.txt');
    });

    it('should tolerate ENOENT without logging an error', async () => {
      const files = {
        file1: { filepath: '/tmp/gone.txt' }
      };

      const enoent = Object.assign(new Error('no such file'), { code: 'ENOENT' });
      mockFsPromise.unlink.mockRejectedValue(enoent);

      await deleteFiles(files);

      expect(mockFsPromise.unlink).toHaveBeenCalledWith('/tmp/gone.txt');
      expect(mockLogger.Error).not.toHaveBeenCalled();
    });

    it('should log non-ENOENT deletion errors gracefully', async () => {
      const files = {
        file1: { path: '/tmp/readonly.txt' }
      };

      const unlinkError = new Error('Permission denied');
      mockFsPromise.unlink.mockRejectedValue(unlinkError);

      await deleteFiles(files);

      expect(mockFsPromise.unlink).toHaveBeenCalledWith('/tmp/readonly.txt');
      expect(mockLogger.Error).toHaveBeenCalledWith(unlinkError);
    });

    it('should skip entries without path/filepath and handle empty input', async () => {
      await deleteFiles({});
      await deleteFiles(undefined as any);
      await deleteFiles({ file1: {} as any, file2: null as any });

      expect(mockFsPromise.unlink).not.toHaveBeenCalled();
      expect(mockLogger.Error).not.toHaveBeenCalled();
    });

    it('should not treat missing files as errors when mixed with real failures', async () => {
      const files = {
        gone: { filepath: '/tmp/gone.txt' },
        bad: { filepath: '/tmp/bad.txt' },
      };

      const enoent = Object.assign(new Error('no such file'), { code: 'ENOENT' });
      const denied = new Error('Permission denied');
      mockFsPromise.unlink
        .mockRejectedValueOnce(enoent)
        .mockRejectedValueOnce(denied);

      await deleteFiles(files);

      expect(mockLogger.Error).toHaveBeenCalledTimes(1);
      expect(mockLogger.Error).toHaveBeenCalledWith(denied);
    });
  });
}); 