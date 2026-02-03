/**
 * Context initialization utilities tests
 * 测试上下文属性初始化工具函数
 */

import { 
  safeDefine, 
  initializeRequestProperties,
  hasRequiredProperties,
  getOrInitStartTime,
  getOrInitRequestId
} from '../src/utils/contextInit';

describe('Context Initialization Utils', () => {
  describe('safeDefine', () => {
    it('should define property on first call', () => {
      const ctx: any = {};
      const result = safeDefine(ctx, 'test', 'value1');
      
      expect(result).toBe(true);
      expect(ctx.test).toBe('value1');
    });

    it('should not redefine property on second call', () => {
      const ctx: any = {};
      const result1 = safeDefine(ctx, 'test', 'value1');
      const result2 = safeDefine(ctx, 'test', 'value2');
      
      expect(result1).toBe(true);
      expect(result2).toBe(false);
      expect(ctx.test).toBe('value1'); // 保持第一次的值
    });

    it('should not throw error when defining property twice', () => {
      const ctx: any = {};
      safeDefine(ctx, 'test', 'value1');
      
      expect(() => {
        safeDefine(ctx, 'test', 'value2');
      }).not.toThrow();
    });
  });

  describe('initializeRequestProperties', () => {
    it('should initialize startTime and requestId', () => {
      const ctx: any = {};
      const requestId = 'test-request-id';
      
      const result = initializeRequestProperties(ctx, requestId);
      
      expect(result.startTimeInitialized).toBe(true);
      expect(result.requestIdInitialized).toBe(true);
      expect(ctx.startTime).toBeDefined();
      expect(ctx.requestId).toBe(requestId);
    });

    it('should not reinitialize existing properties', () => {
      const ctx: any = {};
      const requestId1 = 'request-id-1';
      const requestId2 = 'request-id-2';
      
      const result1 = initializeRequestProperties(ctx, requestId1);
      const originalStartTime = ctx.startTime;
      
      // 模拟延迟
      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
      
      return delay(10).then(() => {
        const result2 = initializeRequestProperties(ctx, requestId2);
        
        expect(result1.startTimeInitialized).toBe(true);
        expect(result1.requestIdInitialized).toBe(true);
        expect(result2.startTimeInitialized).toBe(false); // 已存在
        expect(result2.requestIdInitialized).toBe(false); // 已存在
        expect(ctx.startTime).toBe(originalStartTime); // 保持原值
        expect(ctx.requestId).toBe(requestId1); // 保持第一次的值
      });
    });

    it('should work in multi-protocol scenario simulation', () => {
      const ctx: any = {};
      
      // 模拟 HTTP 协议处理
      const httpResult = initializeRequestProperties(ctx, 'http-request-id');
      
      // 模拟 gRPC 协议处理（同一个请求上下文）
      const grpcResult = initializeRequestProperties(ctx, 'grpc-request-id');
      
      expect(httpResult.startTimeInitialized).toBe(true);
      expect(httpResult.requestIdInitialized).toBe(true);
      expect(grpcResult.startTimeInitialized).toBe(false);
      expect(grpcResult.requestIdInitialized).toBe(false);
      expect(ctx.requestId).toBe('http-request-id'); // 保持第一次的值
    });
  });

  describe('hasRequiredProperties', () => {
    it('should return false for empty context', () => {
      const ctx: any = {};
      expect(hasRequiredProperties(ctx)).toBe(false);
    });

    it('should return false when only startTime exists', () => {
      const ctx: any = { startTime: Date.now() };
      expect(hasRequiredProperties(ctx)).toBe(false);
    });

    it('should return false when only requestId exists', () => {
      const ctx: any = { requestId: 'test-id' };
      expect(hasRequiredProperties(ctx)).toBe(false);
    });

    it('should return true when both properties exist', () => {
      const ctx: any = {};
      initializeRequestProperties(ctx, 'test-id');
      expect(hasRequiredProperties(ctx)).toBe(true);
    });
  });

  describe('getOrInitStartTime', () => {
    it('should initialize startTime if not exists', () => {
      const ctx: any = {};
      const startTime = getOrInitStartTime(ctx);
      
      expect(startTime).toBeDefined();
      expect(typeof startTime).toBe('number');
      expect(ctx.startTime).toBe(startTime);
    });

    it('should return existing startTime', () => {
      const ctx: any = {};
      const startTime1 = getOrInitStartTime(ctx);
      
      // 小延迟确保时间不同
      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
      
      return delay(10).then(() => {
        const startTime2 = getOrInitStartTime(ctx);
        expect(startTime2).toBe(startTime1); // 应该返回同一个值
      });
    });
  });

  describe('getOrInitRequestId', () => {
    it('should initialize requestId if not exists', () => {
      const ctx: any = {};
      const generator = jest.fn(() => 'generated-id');
      
      const requestId = getOrInitRequestId(ctx, generator);
      
      expect(requestId).toBe('generated-id');
      expect(ctx.requestId).toBe('generated-id');
      expect(generator).toHaveBeenCalledTimes(1);
    });

    it('should return existing requestId without calling generator', () => {
      const ctx: any = {};
      const generator1 = jest.fn(() => 'id-1');
      const generator2 = jest.fn(() => 'id-2');
      
      const requestId1 = getOrInitRequestId(ctx, generator1);
      const requestId2 = getOrInitRequestId(ctx, generator2);
      
      expect(requestId1).toBe('id-1');
      expect(requestId2).toBe('id-1'); // 返回已存在的值
      expect(generator1).toHaveBeenCalledTimes(1);
      expect(generator2).not.toHaveBeenCalled(); // 不应该调用第二个生成器
    });
  });

  describe('Integration scenarios', () => {
    it('should handle concurrent initialization attempts', async () => {
      const ctx: any = {};
      
      // 模拟多个并发初始化
      const promises = Array.from({ length: 10 }, (_, i) => {
        return new Promise(resolve => {
          setTimeout(() => {
            const result = initializeRequestProperties(ctx, `request-${i}`);
            resolve(result);
          }, Math.random() * 10);
        });
      });
      
      const results = await Promise.all(promises);
      
      // 应该只有一个初始化成功
      const successCount = results.filter(
        (r: any) => r.startTimeInitialized && r.requestIdInitialized
      ).length;
      
      expect(successCount).toBeGreaterThanOrEqual(1);
      expect(ctx.startTime).toBeDefined();
      expect(ctx.requestId).toBeDefined();
      expect(ctx.requestId).toMatch(/^request-\d+$/);
    });

    it('should maintain property immutability', () => {
      const ctx: any = {};
      initializeRequestProperties(ctx, 'test-id');
      
      const originalStartTime = ctx.startTime;
      const originalRequestId = ctx.requestId;
      
      // 尝试修改属性（应该失败或被忽略，因为是 getter）
      ctx.startTime = Date.now() + 1000;
      ctx.requestId = 'modified-id';
      
      // 属性应该保持不变
      expect(ctx.startTime).toBe(originalStartTime);
      expect(ctx.requestId).toBe(originalRequestId);
    });
  });
});
