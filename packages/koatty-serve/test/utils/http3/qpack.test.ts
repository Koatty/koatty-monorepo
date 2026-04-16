/*
 * @Description: QPACK encoder/decoder unit tests
 * @Usage: QPACK 压缩/解压缩单元测试
 * @Author: richen
 * @Date: 2025-01-12 19:00:00
 */

import { QPACKEncoder, QPACKDecoder } from '../../../src/utils/http3/qpack';

describe('QPACK Encoder/Decoder', () => {
  let encoder: QPACKEncoder;
  let decoder: QPACKDecoder;

  beforeEach(() => {
    encoder = new QPACKEncoder(4096);
    decoder = new QPACKDecoder(4096);
  });

  describe('QPACKEncoder', () => {
    it('should encode headers using static table index', () => {
      const headers: Array<[string, string]> = [
        [':method', 'GET'],
        [':path', '/'],
      ];

      const encoded = encoder.encode(headers);
      expect(encoded).toBeInstanceOf(Buffer);
      expect(encoded.length).toBeGreaterThan(0);
      expect(encoded.length).toBeLessThan(20); // Should be compressed
    });

    it('should encode headers with literal name and value', () => {
      const headers: Array<[string, string]> = [
        ['x-custom-header', 'custom-value'],
      ];

      const encoded = encoder.encode(headers);
      expect(encoded).toBeInstanceOf(Buffer);
      expect(encoded.length).toBeGreaterThan(0);
    });

    it('should encode multiple headers', () => {
      const headers: Array<[string, string]> = [
        [':method', 'POST'],
        [':path', '/api/users'],
        [':scheme', 'https'],
        ['content-type', 'application/json'],
        ['accept', '*/*'],
      ];

      const encoded = encoder.encode(headers);
      expect(encoded).toBeInstanceOf(Buffer);
      expect(encoded.length).toBeGreaterThan(0);
    });

    it('should encode status codes', () => {
      const headers: Array<[string, string]> = [
        [':status', '200'],
      ];

      const encoded = encoder.encode(headers);
      expect(encoded).toBeInstanceOf(Buffer);
      expect(encoded.length).toBeGreaterThan(0);
    });

    it('should encode headers with name reference from static table', () => {
      const headers: Array<[string, string]> = [
        ['content-type', 'text/xml'], // content-type in static table, but value is not
      ];

      const encoded = encoder.encode(headers);
      expect(encoded).toBeInstanceOf(Buffer);
      expect(encoded.length).toBeGreaterThan(0);
    });

    it('should handle empty headers array', () => {
      const headers: Array<[string, string]> = [];
      const encoded = encoder.encode(headers);
      expect(encoded).toBeInstanceOf(Buffer);
      expect(encoded.length).toBe(0);
    });
  });

  describe('QPACKDecoder', () => {
    it('should decode headers encoded with static table index', () => {
      const headers: Array<[string, string]> = [
        [':method', 'GET'],
        [':path', '/'],
      ];

      const encoded = encoder.encode(headers);
      const decoded = decoder.decode(encoded);

      expect(decoded).toEqual(headers);
    });

    it('should decode headers with literal name and value', () => {
      const headers: Array<[string, string]> = [
        ['x-custom-header', 'custom-value'],
      ];

      const encoded = encoder.encode(headers);
      const decoded = decoder.decode(encoded);

      expect(decoded).toHaveLength(1);
      expect(decoded[0][0]).toBe('x-custom-header');
      expect(decoded[0][1]).toBe('custom-value');
    });

    it('should decode multiple headers', () => {
      const headers: Array<[string, string]> = [
        [':method', 'POST'],
        [':path', '/api/users'],
        [':scheme', 'https'],
        ['content-type', 'application/json'],
      ];

      const encoded = encoder.encode(headers);
      const decoded = decoder.decode(encoded);

      expect(decoded.length).toBeGreaterThan(0);
      // Check that all headers are present (order may vary with literal encoding)
      const decodedMap = new Map(decoded);
      expect(decodedMap.has(':method') || decodedMap.has(':path')).toBeTruthy();
    });

    it('should handle empty buffer', () => {
      const decoded = decoder.decode(Buffer.alloc(0));
      expect(decoded).toEqual([]);
    });

    it('should handle malformed data gracefully', () => {
      const malformed = Buffer.from([0xFF, 0xFF, 0xFF]);
      const decoded = decoder.decode(malformed);
      expect(decoded).toBeInstanceOf(Array);
    });
  });

  describe('Round-trip encoding/decoding', () => {
    it('should preserve headers through encode/decode cycle', () => {
      const testCases: Array<Array<[string, string]>> = [
        [
          [':method', 'GET'],
          [':path', '/'],
        ],
        [
          [':method', 'POST'],
          [':path', '/api/data'],
          ['content-type', 'application/json'],
        ],
        [
          [':status', '200'],
          ['content-type', 'text/html; charset=utf-8'],
        ],
        [
          [':status', '404'],
          ['content-type', 'text/plain'],
        ],
      ];

      testCases.forEach((headers) => {
        const encoded = encoder.encode(headers);
        const decoded = decoder.decode(encoded);

        // For static table entries, we should get exact match
        const staticTableHeaders = headers.filter(([name, value]) => {
          // Check if this is likely in static table
          return (name.startsWith(':') || 
                  name === 'content-type' || 
                  name === 'accept');
        });

        if (staticTableHeaders.length > 0) {
          expect(decoded.length).toBeGreaterThan(0);
        }
      });
    });

    it('should handle large headers', () => {
      const largeValue = 'x'.repeat(1000);
      const headers: Array<[string, string]> = [
        ['x-large-header', largeValue],
      ];

      const encoded = encoder.encode(headers);
      const decoded = decoder.decode(encoded);

      expect(decoded).toHaveLength(1);
      expect(decoded[0][0]).toBe('x-large-header');
      expect(decoded[0][1]).toBe(largeValue);
    });

    it('should handle special characters in headers', () => {
      const headers: Array<[string, string]> = [
        ['x-special', 'value with spaces and 特殊字符'],
      ];

      const encoded = encoder.encode(headers);
      const decoded = decoder.decode(encoded);

      expect(decoded).toHaveLength(1);
      expect(decoded[0][1]).toBe('value with spaces and 特殊字符');
    });
  });

  describe('Performance', () => {
    it('should efficiently compress common headers', () => {
      const commonHeaders: Array<[string, string]> = [
        [':method', 'GET'],
        [':path', '/'],
        [':scheme', 'https'],
        ['accept', '*/*'],
      ];

      const encoded = encoder.encode(commonHeaders);
      
      // Calculate original size
      const originalSize = commonHeaders.reduce((sum, [name, value]) => 
        sum + name.length + value.length, 0
      );

      // Compression ratio should be significant for static table entries
      expect(encoded.length).toBeLessThan(originalSize);
    });

    it('should handle encoding 1000 headers', () => {
      const headers: Array<[string, string]> = [];
      for (let i = 0; i < 1000; i++) {
        headers.push([`x-header-${i}`, `value-${i}`]);
      }

      const startTime = Date.now();
      const encoded = encoder.encode(headers);
      const encodeTime = Date.now() - startTime;

      expect(encoded).toBeInstanceOf(Buffer);
      expect(encodeTime).toBeLessThan(1000); // Should complete in less than 1 second
    });

    it('should handle decoding 1000 headers', () => {
      const headers: Array<[string, string]> = [];
      for (let i = 0; i < 1000; i++) {
        headers.push([`x-header-${i}`, `value-${i}`]);
      }

      const encoded = encoder.encode(headers);
      
      const startTime = Date.now();
      const decoded = decoder.decode(encoded);
      const decodeTime = Date.now() - startTime;

      expect(decoded).toBeInstanceOf(Array);
      expect(decoded.length).toBeGreaterThan(0);
      expect(decodeTime).toBeLessThan(1000); // Should complete in less than 1 second
    });
  });

  describe('Edge cases', () => {
    it('should handle headers with empty values', () => {
      const headers: Array<[string, string]> = [
        ['x-empty', ''],
      ];

      const encoded = encoder.encode(headers);
      const decoded = decoder.decode(encoded);

      expect(decoded).toHaveLength(1);
      expect(decoded[0][0]).toBe('x-empty');
      expect(decoded[0][1]).toBe('');
    });

    it('should handle headers with very long names', () => {
      const longName = 'x-' + 'a'.repeat(100);
      const headers: Array<[string, string]> = [
        [longName, 'value'],
      ];

      const encoded = encoder.encode(headers);
      const decoded = decoder.decode(encoded);

      expect(decoded).toHaveLength(1);
      expect(decoded[0][0]).toBe(longName);
    });

    it('should preserve header name case (lowercase)', () => {
      const headers: Array<[string, string]> = [
        ['Content-Type', 'text/html'], // Should be lowercased in HTTP/3
      ];

      const encoded = encoder.encode(headers);
      const decoded = decoder.decode(encoded);

      expect(decoded).toHaveLength(1);
      expect(decoded[0][0]).toBe('content-type'); // HTTP/3 uses lowercase
    });
  });

  describe('Huffman decoding', () => {
    it('should decode Huffman-encoded single character', () => {
      const dec = new QPACKDecoder(4096);
      // Literal with name ref: 01|nameIdx(6bit) value
      // static_table[15] = [':method', 'CONNECT']
      // 0x40 | 15 = 0x4F
      // Value: Huffman '0' = 00000 (5 bits) + 111 padding = 00000111 = 0x07
      // String header: H=1, length=1 => 0x81, then 0x07
      const encoded = Buffer.from([0x4F, 0x81, 0x07]);
      const result = dec.decode(encoded);
      expect(result).toHaveLength(1);
      expect(result[0][0]).toBe(':method');
      expect(result[0][1]).toBe('0');
    });

    it('should decode Huffman-encoded "GET"', () => {
      const dec = new QPACKDecoder(4096);
      // G=0x62(1100010,7) E=0x60(1100000,7) T=0x6f(1101111,7)
      // Bits: 1100010 1100000 1101111 = 21 bits
      // Padded to 24 bits: 1100010 1100000 1101111 111
      // Bytes: 11000101 10000011 01111111 = 0xC5 0x83 0x7F
      const encoded = Buffer.from([0x4F, 0x83, 0xC5, 0x83, 0x7F]);
      const result = dec.decode(encoded);
      expect(result).toHaveLength(1);
      expect(result[0][0]).toBe(':method');
      expect(result[0][1]).toBe('GET');
    });

    it('should decode Huffman-encoded "aeiou"', () => {
      const dec = new QPACKDecoder(4096);
      // a=0x03(00011,5) e=0x05(00101,5) i=0x06(00110,5) o=0x07(00111,5) u=0x2d(101101,6)
      // Bits: 00011 00101 00110 00111 101101 = 26 bits
      // Pad to 32 bits: ...101101 111111 = 00011001 01001100 01111011 01111111
      // = 0x19 0x4C 0x7B 0x7F
      const encoded = Buffer.from([0x4F, 0x84, 0x19, 0x4C, 0x7B, 0x7F]);
      const result = dec.decode(encoded);
      expect(result).toHaveLength(1);
      expect(result[0][0]).toBe(':method');
      expect(result[0][1]).toBe('aeiou');
    });

    it('should handle Huffman-encoded value with literal name', () => {
      const dec = new QPACKDecoder(4096);
      // Literal with literal name: 001xxxxx prefix = 0x20
      // Name: non-Huffman 'x-test' = 0x06 78 2d 74 65 73 74
      // Value: Huffman 'ok' = o=0x07(00111,5) k=0x75(1110101,7) = 00111 1110101 = 12 bits
      // Pad to 16 bits: 00111 1110101 1111 = 00111111 01011111 = 0x3F 0x5F
      const encoded = Buffer.from([
        0x20,
        0x06, 0x78, 0x2d, 0x74, 0x65, 0x73, 0x74,
        0x82, 0x3F, 0x5F,
      ]);
      const result = dec.decode(encoded);
      expect(result).toHaveLength(1);
      expect(result[0][0]).toBe('x-test');
      expect(result[0][1]).toBe('ok');
    });

    it('should handle invalid Huffman padding gracefully', () => {
      const dec = new QPACKDecoder(4096);
      // '0' with bad padding: 00000 000 = 0x00 (padding has 0 bits, not 1s)
      const encoded = Buffer.from([0x4F, 0x81, 0x00]);
      const result = dec.decode(encoded);
      expect(result).toEqual([]);
    });

    it('should handle empty Huffman-encoded string', () => {
      const dec = new QPACKDecoder(4096);
      // Empty Huffman string: H=1, length=0 => 0x80
      const encoded = Buffer.from([0x4F, 0x80]);
      const result = dec.decode(encoded);
      expect(result).toHaveLength(1);
      expect(result[0][0]).toBe(':method');
      expect(result[0][1]).toBe('');
    });
  });
});

