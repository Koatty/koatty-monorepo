/**
 * Catch 装饰器测试
 * Catch Decorator Tests
 */

import {
  Exception,
  ExceptionHandler,
  CommonErrorCode,
  Catch,
  CatchOptions,
  setExceptionConfig,
  isException
} from '../src/index';

describe('Catch Decorator', () => {
  beforeEach(() => {
    // 重置配置
    setExceptionConfig({
      enableStackTrace: false,
      logFormat: 'json',
      maxStackLength: 1000
    });
  });

  // 自定义异常类
  @ExceptionHandler()
  class ValidationException extends Exception {
    constructor(message: string, code?: number, status?: number) {
      super(message, code ?? CommonErrorCode.VALIDATION_ERROR, status ?? 400);
    }
  }

  @ExceptionHandler()
  class BusinessException extends Exception {
    constructor(message: string, code?: number, status?: number) {
      super(message, code ?? 2000, status ?? 500);
    }
  }

  describe('Basic Usage', () => {
    it('should catch errors and convert to Exception', async () => {
      class TestService {
        @Catch()
        async throwError(): Promise<void> {
          throw new Error('原始错误');
        }
      }

      const service = new TestService();

      try {
        await service.throwError();
        fail('Should have thrown an exception');
      } catch (err) {
        expect(isException(err)).toBe(true);
        expect((err as Exception).message).toBe('原始错误');
        expect((err as Exception).code).toBe(CommonErrorCode.GENERAL_ERROR);
        expect((err as Exception).status).toBe(500);
      }
    });

    it('should handle sync methods', async () => {
      class TestService {
        @Catch()
        syncMethod(): string {
          throw new Error('同步方法错误');
        }
      }

      const service = new TestService();

      try {
        await service.syncMethod();
        fail('Should have thrown an exception');
      } catch (err) {
        expect(isException(err)).toBe(true);
        expect((err as Exception).message).toBe('同步方法错误');
      }
    });

    it('should not modify successful returns', async () => {
      class TestService {
        @Catch()
        async successMethod(): Promise<string> {
          return '成功';
        }
      }

      const service = new TestService();
      const result = await service.successMethod();
      expect(result).toBe('成功');
    });

    it('should handle Promise returns correctly', async () => {
      class TestService {
        @Catch()
        async asyncMethod(): Promise<{ data: string }> {
          return Promise.resolve({ data: '异步数据' });
        }
      }

      const service = new TestService();
      const result = await service.asyncMethod();
      expect(result).toEqual({ data: '异步数据' });
    });
  });

  describe('Code and Message Options', () => {
    it('should use custom error code and message (shorthand)', async () => {
      class TestService {
        @Catch(1001, '自定义错误消息')
        async throwError(): Promise<void> {
          throw new Error('原始错误');
        }
      }

      const service = new TestService();

      try {
        await service.throwError();
        fail('Should have thrown an exception');
      } catch (err) {
        expect(isException(err)).toBe(true);
        expect((err as Exception).message).toBe('自定义错误消息');
        expect((err as Exception).code).toBe(1001);
      }
    });

    it('should use custom code only (shorthand)', async () => {
      class TestService {
        @Catch(2002)
        async throwError(): Promise<void> {
          throw new Error('保留的错误消息');
        }
      }

      const service = new TestService();

      try {
        await service.throwError();
        fail('Should have thrown an exception');
      } catch (err) {
        expect(isException(err)).toBe(true);
        expect((err as Exception).message).toBe('保留的错误消息');
        expect((err as Exception).code).toBe(2002);
      }
    });

    it('should support dynamic message function', async () => {
      class TestService {
        @Catch({
          code: 3001,
          message: (err: Error) => `处理失败: ${err.message}`
        })
        async throwError(): Promise<void> {
          throw new Error('数据库连接失败');
        }
      }

      const service = new TestService();

      try {
        await service.throwError();
        fail('Should have thrown an exception');
      } catch (err) {
        expect(isException(err)).toBe(true);
        expect((err as Exception).message).toBe('处理失败: 数据库连接失败');
        expect((err as Exception).code).toBe(3001);
      }
    });
  });

  describe('Custom Exception Class', () => {
    it('should use custom Exception class (shorthand)', async () => {
      class TestService {
        @Catch(ValidationException)
        async validateData(): Promise<void> {
          throw new Error('验证失败');
        }
      }

      const service = new TestService();

      try {
        await service.validateData();
        fail('Should have thrown an exception');
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationException);
        expect((err as ValidationException).message).toBe('验证失败');
        expect((err as ValidationException).code).toBe(CommonErrorCode.VALIDATION_ERROR);
        expect((err as ValidationException).status).toBe(400);
      }
    });

    it('should use custom Exception class with options', async () => {
      class TestService {
        @Catch({
          exception: BusinessException,
          code: 2001,
          status: 400,
          message: '业务处理失败'
        })
        async processOrder(): Promise<void> {
          throw new Error('原始业务错误');
        }
      }

      const service = new TestService();

      try {
        await service.processOrder();
        fail('Should have thrown an exception');
      } catch (err) {
        expect(err).toBeInstanceOf(BusinessException);
        expect((err as BusinessException).message).toBe('业务处理失败');
        expect((err as BusinessException).code).toBe(2001);
        expect((err as BusinessException).status).toBe(400);
      }
    });
  });

  describe('Catch Types Filter', () => {
    it('should only catch specified error types', async () => {
      class TestService {
        @Catch({
          catchTypes: [TypeError],
          code: 4001,
          message: '类型错误'
        })
        async throwTypeError(): Promise<void> {
          throw new TypeError('类型不匹配');
        }

        @Catch({
          catchTypes: [TypeError],
          code: 4001,
          message: '类型错误'
        })
        async throwRangeError(): Promise<void> {
          throw new RangeError('范围错误');
        }
      }

      const service = new TestService();

      // TypeError 应该被捕获并转换
      try {
        await service.throwTypeError();
        fail('Should have thrown an exception');
      } catch (err) {
        expect(isException(err)).toBe(true);
        expect((err as Exception).message).toBe('类型错误');
        expect((err as Exception).code).toBe(4001);
      }

      // RangeError 不应该被捕获，原样抛出
      try {
        await service.throwRangeError();
        fail('Should have thrown an exception');
      } catch (err) {
        expect(err).toBeInstanceOf(RangeError);
        expect((err as RangeError).message).toBe('范围错误');
      }
    });

    it('should catch multiple error types', async () => {
      class TestService {
        @Catch([TypeError, RangeError], { code: 5001 })
        async throwTypeError(): Promise<void> {
          throw new TypeError('类型错误');
        }

        @Catch([TypeError, RangeError], { code: 5001 })
        async throwRangeError(): Promise<void> {
          throw new RangeError('范围错误');
        }

        @Catch([TypeError, RangeError], { code: 5001 })
        async throwSyntaxError(): Promise<void> {
          throw new SyntaxError('语法错误');
        }
      }

      const service = new TestService();

      // TypeError 应该被捕获
      try {
        await service.throwTypeError();
        fail('Should have thrown an exception');
      } catch (err) {
        expect(isException(err)).toBe(true);
        expect((err as Exception).code).toBe(5001);
      }

      // RangeError 应该被捕获
      try {
        await service.throwRangeError();
        fail('Should have thrown an exception');
      } catch (err) {
        expect(isException(err)).toBe(true);
        expect((err as Exception).code).toBe(5001);
      }

      // SyntaxError 不应该被捕获
      try {
        await service.throwSyntaxError();
        fail('Should have thrown an exception');
      } catch (err) {
        expect(err).toBeInstanceOf(SyntaxError);
      }
    });
  });

  describe('Transform Function', () => {
    it('should apply transform function', async () => {
      class TestService {
        @Catch({
          exception: BusinessException,
          transform: (ex, originalError) => {
            return ex.setContext({
              originalMessage: originalError.message,
              timestamp: 12345
            });
          }
        })
        async processData(): Promise<void> {
          throw new Error('处理失败');
        }
      }

      const service = new TestService();

      try {
        await service.processData();
        fail('Should have thrown an exception');
      } catch (err) {
        expect(err).toBeInstanceOf(BusinessException);
        expect((err as BusinessException).context?.originalMessage).toBe('处理失败');
        expect((err as BusinessException).context?.timestamp).toBe(12345);
      }
    });
  });

  describe('Preserve Stack', () => {
    it('should preserve original stack trace by default', async () => {
      class TestService {
        @Catch({ code: 6001 })
        async throwError(): Promise<void> {
          throw new Error('带堆栈的错误');
        }
      }

      const service = new TestService();

      try {
        await service.throwError();
        fail('Should have thrown an exception');
      } catch (err) {
        expect(isException(err)).toBe(true);
        expect((err as Exception).stack).toBeDefined();
        expect((err as Exception).stack).toContain('Error: 带堆栈的错误');
      }
    });

    it('should not preserve stack when disabled', async () => {
      class TestService {
        @Catch({ code: 6002, preserveStack: false })
        async throwError(): Promise<void> {
          throw new Error('不保留堆栈的错误');
        }
      }

      const service = new TestService();

      try {
        await service.throwError();
        fail('Should have thrown an exception');
      } catch (err) {
        expect(isException(err)).toBe(true);
        // 应该有 Exception 自己的堆栈，但不是原始错误的
        expect((err as Exception).stack).toBeDefined();
      }
    });
  });

  describe('Suppress Option', () => {
    it('should suppress error when suppress is true', async () => {
      class TestService {
        @Catch({ suppress: true })
        async throwError(): Promise<string> {
          throw new Error('被抑制的错误');
        }
      }

      const service = new TestService();
      const result = await service.throwError();
      expect(result).toBeUndefined();
    });
  });

  describe('Preserve Existing Exceptions', () => {
    it('should preserve existing Exception when no options specified', async () => {
      const originalException = new BusinessException('原始业务异常', 9001, 400);

      class TestService {
        @Catch()
        async throwBusinessException(): Promise<void> {
          throw originalException;
        }
      }

      const service = new TestService();

      try {
        await service.throwBusinessException();
        fail('Should have thrown an exception');
      } catch (err) {
        expect(err).toBe(originalException);
        expect((err as BusinessException).message).toBe('原始业务异常');
        expect((err as BusinessException).code).toBe(9001);
      }
    });

    it('should convert Exception when options are specified', async () => {
      const originalException = new BusinessException('原始业务异常', 9001, 400);

      class TestService {
        @Catch({ code: 9999, message: '转换后的消息' })
        async throwBusinessException(): Promise<void> {
          throw originalException;
        }
      }

      const service = new TestService();

      try {
        await service.throwBusinessException();
        fail('Should have thrown an exception');
      } catch (err) {
        expect(isException(err)).toBe(true);
        expect((err as Exception).message).toBe('转换后的消息');
        expect((err as Exception).code).toBe(9999);
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle non-Error throws', async () => {
      class TestService {
        @Catch({ code: 8001 })
        async throwString(): Promise<void> {
          throw '字符串错误';
        }

        @Catch({ code: 8002 })
        async throwNumber(): Promise<void> {
          throw 404;
        }

        @Catch({ code: 8003 })
        async throwObject(): Promise<void> {
          throw { message: '对象错误' };
        }
      }

      const service = new TestService();

      // 字符串错误
      try {
        await service.throwString();
        fail('Should have thrown an exception');
      } catch (err) {
        expect(isException(err)).toBe(true);
        expect((err as Exception).message).toBe('字符串错误');
        expect((err as Exception).code).toBe(8001);
      }

      // 数字错误
      try {
        await service.throwNumber();
        fail('Should have thrown an exception');
      } catch (err) {
        expect(isException(err)).toBe(true);
        expect((err as Exception).message).toBe('404');
        expect((err as Exception).code).toBe(8002);
      }

      // 对象错误
      try {
        await service.throwObject();
        fail('Should have thrown an exception');
      } catch (err) {
        expect(isException(err)).toBe(true);
        expect((err as Exception).message).toBe('对象错误');
        expect((err as Exception).code).toBe(8003);
      }
    });

    it('should handle null and undefined throws', async () => {
      class TestService {
        @Catch({ code: 8004 })
        async throwNull(): Promise<void> {
          throw null;
        }

        @Catch({ code: 8005 })
        async throwUndefined(): Promise<void> {
          throw undefined;
        }
      }

      const service = new TestService();

      try {
        await service.throwNull();
        fail('Should have thrown an exception');
      } catch (err) {
        expect(isException(err)).toBe(true);
        expect((err as Exception).message).toBe('Unknown error occurred');
        expect((err as Exception).code).toBe(8004);
      }

      try {
        await service.throwUndefined();
        fail('Should have thrown an exception');
      } catch (err) {
        expect(isException(err)).toBe(true);
        expect((err as Exception).message).toBe('Unknown error occurred');
        expect((err as Exception).code).toBe(8005);
      }
    });
  });

  describe('Real World Scenarios', () => {
    // 模拟数据库操作错误
    class DatabaseError extends Error {
      constructor(message: string, public readonly errno: number) {
        super(message);
        this.name = 'DatabaseError';
      }
    }

    @ExceptionHandler()
    class DatabaseException extends Exception {
      constructor(message: string, code?: number, status?: number) {
        super(message, code ?? CommonErrorCode.INTERNAL_SERVER_ERROR, status ?? 500);
      }
    }

    it('should handle database operation errors', async () => {
      class UserRepository {
        @Catch({
          exception: DatabaseException,
          catchTypes: [DatabaseError],
          message: (err) => `数据库操作失败: ${err.message}`,
          code: CommonErrorCode.INTERNAL_SERVER_ERROR
        })
        async findById(id: string): Promise<{ id: string; name: string }> {
          if (id === 'error') {
            throw new DatabaseError('Connection refused', 1045);
          }
          return { id, name: 'User' };
        }
      }

      const repo = new UserRepository();

      // 成功场景
      const user = await repo.findById('123');
      expect(user.id).toBe('123');

      // 错误场景
      try {
        await repo.findById('error');
        fail('Should have thrown an exception');
      } catch (err) {
        expect(err).toBeInstanceOf(DatabaseException);
        expect((err as DatabaseException).message).toBe('数据库操作失败: Connection refused');
        expect((err as DatabaseException).code).toBe(CommonErrorCode.INTERNAL_SERVER_ERROR);
      }
    });

    it('should handle validation in service layer', async () => {
      class UserService {
        @Catch(ValidationException)
        async createUser(data: { email: string; name: string }): Promise<{ id: number }> {
          if (!data.email.includes('@')) {
            throw new Error('Invalid email format');
          }
          if (data.name.length < 2) {
            throw new Error('Name too short');
          }
          return { id: 1 };
        }
      }

      const service = new UserService();

      try {
        await service.createUser({ email: 'invalid', name: 'test' });
        fail('Should have thrown an exception');
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationException);
        expect((err as ValidationException).message).toBe('Invalid email format');
        expect((err as ValidationException).status).toBe(400);
      }
    });

    it('should support multiple decorators on different methods', async () => {
      class OrderService {
        @Catch(ValidationException)
        async validateOrder(orderId: string): Promise<boolean> {
          if (!orderId) {
            throw new Error('Order ID is required');
          }
          return true;
        }

        @Catch({
          exception: BusinessException,
          code: 2001,
          message: '订单处理失败'
        })
        async processOrder(orderId: string): Promise<{ status: string }> {
          if (orderId === 'fail') {
            throw new Error('Processing failed');
          }
          return { status: 'completed' };
        }

        @Catch({
          code: 3001,
          status: 402,
          message: '支付失败'
        })
        async payOrder(orderId: string): Promise<{ paid: boolean }> {
          if (orderId === 'no-funds') {
            throw new Error('Insufficient funds');
          }
          return { paid: true };
        }
      }

      const service = new OrderService();

      // 验证错误
      try {
        await service.validateOrder('');
        fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationException);
      }

      // 业务处理错误
      try {
        await service.processOrder('fail');
        fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(BusinessException);
        expect((err as BusinessException).code).toBe(2001);
      }

      // 支付错误
      try {
        await service.payOrder('no-funds');
        fail('Should have thrown');
      } catch (err) {
        expect(isException(err)).toBe(true);
        expect((err as Exception).code).toBe(3001);
        expect((err as Exception).status).toBe(402);
      }

      // 成功场景
      expect(await service.validateOrder('123')).toBe(true);
      expect(await service.processOrder('123')).toEqual({ status: 'completed' });
      expect(await service.payOrder('123')).toEqual({ paid: true });
    });
  });
});
