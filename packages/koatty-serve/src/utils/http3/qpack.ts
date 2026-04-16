/*
 * @Description: QPACK (QPACK: Field Compression for HTTP/3) implementation
 * @Usage: RFC 9204 - QPACK 头部压缩实现
 * @Author: richen
 * @Date: 2025-01-12 18:00:00
 * @LastEditTime: 2025-01-12 18:00:00
 */

import { createLogger } from '../../utils/logger';

const logger = createLogger({ module: 'qpack' });

/**
 * QPACK 静态表 (RFC 9204 Appendix A)
 * 包含常用的 HTTP 头部字段
 */
const STATIC_TABLE: Array<[string, string]> = [
  [':authority', ''],
  [':path', '/'],
  ['age', '0'],
  ['content-disposition', ''],
  ['content-length', '0'],
  ['cookie', ''],
  ['date', ''],
  ['etag', ''],
  ['if-modified-since', ''],
  ['if-none-match', ''],
  ['last-modified', ''],
  ['link', ''],
  ['location', ''],
  ['referer', ''],
  ['set-cookie', ''],
  [':method', 'CONNECT'],
  [':method', 'DELETE'],
  [':method', 'GET'],
  [':method', 'HEAD'],
  [':method', 'OPTIONS'],
  [':method', 'POST'],
  [':method', 'PUT'],
  [':scheme', 'http'],
  [':scheme', 'https'],
  [':status', '103'],
  [':status', '200'],
  [':status', '304'],
  [':status', '404'],
  [':status', '503'],
  ['accept', '*/*'],
  ['accept', 'application/dns-message'],
  ['accept-encoding', 'gzip, deflate, br'],
  ['accept-ranges', 'bytes'],
  ['access-control-allow-headers', 'cache-control'],
  ['access-control-allow-headers', 'content-type'],
  ['access-control-allow-origin', '*'],
  ['cache-control', 'max-age=0'],
  ['cache-control', 'max-age=2592000'],
  ['cache-control', 'max-age=604800'],
  ['cache-control', 'no-cache'],
  ['cache-control', 'no-store'],
  ['cache-control', 'public, max-age=31536000'],
  ['content-encoding', 'br'],
  ['content-encoding', 'gzip'],
  ['content-type', 'application/dns-message'],
  ['content-type', 'application/javascript'],
  ['content-type', 'application/json'],
  ['content-type', 'application/x-www-form-urlencoded'],
  ['content-type', 'image/gif'],
  ['content-type', 'image/jpeg'],
  ['content-type', 'image/png'],
  ['content-type', 'text/css'],
  ['content-type', 'text/html; charset=utf-8'],
  ['content-type', 'text/plain'],
  ['content-type', 'text/plain;charset=utf-8'],
  ['range', 'bytes=0-'],
  ['strict-transport-security', 'max-age=31536000'],
  ['strict-transport-security', 'max-age=31536000; includesubdomains'],
  ['strict-transport-security', 'max-age=31536000; includesubdomains; preload'],
  ['vary', 'accept-encoding'],
  ['vary', 'origin'],
  ['x-content-type-options', 'nosniff'],
  ['x-xss-protection', '1; mode=block'],
  [':status', '100'],
  [':status', '204'],
  [':status', '206'],
  [':status', '302'],
  [':status', '400'],
  [':status', '403'],
  [':status', '421'],
  [':status', '425'],
  [':status', '500'],
  ['accept-language', ''],
  ['access-control-allow-credentials', 'FALSE'],
  ['access-control-allow-credentials', 'TRUE'],
  ['access-control-allow-headers', '*'],
  ['access-control-allow-methods', 'get'],
  ['access-control-allow-methods', 'get, post, options'],
  ['access-control-allow-methods', 'options'],
  ['access-control-expose-headers', 'content-length'],
  ['access-control-request-headers', 'content-type'],
  ['access-control-request-method', 'get'],
  ['access-control-request-method', 'post'],
  ['alt-svc', 'clear'],
  ['authorization', ''],
  ['content-security-policy', "script-src 'none'; object-src 'none'; base-uri 'none'"],
  ['early-data', '1'],
  ['expect-ct', ''],
  ['forwarded', ''],
  ['if-range', ''],
  ['origin', ''],
  ['purpose', 'prefetch'],
  ['server', ''],
  ['timing-allow-origin', '*'],
  ['upgrade-insecure-requests', '1'],
  ['user-agent', ''],
  ['x-forwarded-for', ''],
  ['x-frame-options', 'deny'],
  ['x-frame-options', 'sameorigin'],
];

const HUFFMAN_CODES: [number, number][] = [
  [0x1ff8, 13], [0x7fffd8, 23], [0xfffffe2, 28], [0xfffffe3, 28],
  [0xfffffe4, 28], [0xfffffe5, 28], [0xfffffe6, 28], [0xfffffe7, 28],
  [0xfffffe8, 28], [0xffffea, 24], [0x3ffffffc, 30], [0xfffffe9, 28],
  [0xfffffea, 28], [0x3ffffffd, 30], [0xfffffeb, 28], [0xfffffec, 28],
  [0xfffffed, 28], [0xfffffee, 28], [0xfffffef, 28], [0xffffff0, 28],
  [0xffffff1, 28], [0xffffff2, 28], [0x3ffffffe, 30], [0xffffff3, 28],
  [0xffffff4, 28], [0xffffff5, 28], [0xffffff6, 28], [0xffffff7, 28],
  [0xffffff8, 28], [0xffffff9, 28], [0xffffffa, 28], [0xffffffb, 28],
  [0x14, 6], [0x3f8, 10], [0x3f9, 10], [0xffa, 12],
  [0x1ff9, 13], [0x15, 6], [0xf8, 8], [0x7fa, 11],
  [0x3fa, 10], [0x3fb, 10], [0xf9, 8], [0x7fb, 11],
  [0xfa, 8], [0x16, 6], [0x17, 6], [0x18, 6],
  [0x0, 5], [0x1, 5], [0x2, 5], [0x19, 6],
  [0x1a, 6], [0x1b, 6], [0x1c, 6], [0x1d, 6],
  [0x1e, 6], [0x1f, 6], [0x5c, 7], [0xfb, 8],
  [0x7ffc, 15], [0x20, 6], [0xffb, 12], [0x3fc, 10],
  [0x1ffa, 13], [0x21, 6], [0x5d, 7], [0x5e, 7],
  [0x5f, 7], [0x60, 7], [0x61, 7], [0x62, 7],
  [0x63, 7], [0x64, 7], [0x65, 7], [0x66, 7],
  [0x67, 7], [0x68, 7], [0x69, 7], [0x6a, 7],
  [0x6b, 7], [0x6c, 7], [0x6d, 7], [0x6e, 7],
  [0x6f, 7], [0x70, 7], [0x71, 7], [0x72, 7],
  [0xfc, 8], [0x73, 7], [0xfd, 8], [0x1ffb, 13],
  [0x7fff0, 19], [0x1ffc, 13], [0x3ffc, 14], [0x22, 6],
  [0x7ffd, 15], [0x3, 5], [0x23, 6], [0x4, 5],
  [0x24, 6], [0x5, 5], [0x25, 6], [0x26, 6],
  [0x27, 6], [0x6, 5], [0x74, 7], [0x75, 7],
  [0x28, 6], [0x29, 6], [0x2a, 6], [0x7, 5],
  [0x2b, 6], [0x76, 7], [0x2c, 6], [0x8, 5],
  [0x9, 5], [0x2d, 6], [0x77, 7], [0x78, 7],
  [0x79, 7], [0x7a, 7], [0x7b, 7], [0x7ffe, 15],
  [0x7fc, 11], [0x3ffd, 14], [0x1ffd, 13], [0xffffffc, 28],
  [0xfffe6, 20], [0x3fffd2, 22], [0xfffe7, 20], [0xfffe8, 20],
  [0x3fffd3, 22], [0x3fffd4, 22], [0x3fffd5, 22], [0x7fffd9, 23],
  [0x3fffd6, 22], [0x7fffda, 23], [0x7fffdb, 23], [0x7fffdc, 23],
  [0x7fffdd, 23], [0x7fffde, 23], [0xffffeb, 24], [0x7fffdf, 23],
  [0xffffec, 24], [0xffffed, 24], [0x3fffd7, 22], [0x7fffe0, 23],
  [0xffffee, 24], [0x7fffe1, 23], [0x7fffe2, 23], [0x7fffe3, 23],
  [0x7fffe4, 23], [0x1fffdc, 21], [0x3fffd8, 22], [0x7fffe5, 23],
  [0x3fffd9, 22], [0x7fffe6, 23], [0x7fffe7, 23], [0xffffef, 24],
  [0x3fffda, 22], [0x1fffdd, 21], [0xfffe9, 20], [0x3fffdb, 22],
  [0x3fffdc, 22], [0x7fffe8, 23], [0x7fffe9, 23], [0x1fffde, 21],
  [0x7fffea, 23], [0x3fffdd, 22], [0x3fffde, 22], [0xfffff0, 24],
  [0x1fffdf, 21], [0x3fffdf, 22], [0x7fffeb, 23], [0x7fffec, 23],
  [0x1fffe0, 21], [0x1fffe1, 21], [0x3fffe0, 22], [0x1fffe2, 21],
  [0x7fffed, 23], [0x3fffe1, 22], [0x7fffee, 23], [0x7fffef, 23],
  [0xfffea, 20], [0x3fffe2, 22], [0x3fffe3, 22], [0x3fffe4, 22],
  [0x7ffff0, 23], [0x3fffe5, 22], [0x3fffe6, 22], [0x7ffff1, 23],
  [0x3ffffe0, 26], [0x3ffffe1, 26], [0xfffeb, 20], [0x7fff1, 19],
  [0x3fffe7, 22], [0x7ffff2, 23], [0x3fffe8, 22], [0x1ffffec, 25],
  [0x3ffffe2, 26], [0x3ffffe3, 26], [0x3ffffe4, 26], [0x7ffffde, 27],
  [0x7ffffdf, 27], [0x3ffffe5, 26], [0xfffff1, 24], [0x1ffffed, 25],
  [0x7fff2, 19], [0x1fffe3, 21], [0x3ffffe6, 26], [0x7ffffe0, 27],
  [0x7ffffe1, 27], [0x3ffffe7, 26], [0x7ffffe2, 27], [0xfffff2, 24],
  [0x1fffe4, 21], [0x1fffe5, 21], [0x3ffffe8, 26], [0x3ffffe9, 26],
  [0xffffffd, 28], [0x7ffffe3, 27], [0x7ffffe4, 27], [0x7ffffe5, 27],
  [0xfffec, 20], [0xfffff3, 24], [0xfffed, 20], [0x1fffe6, 21],
  [0x3fffe9, 22], [0x1fffe7, 21], [0x1fffe8, 21], [0x7ffff3, 23],
  [0x3fffea, 22], [0x3fffeb, 22], [0x1ffffee, 25], [0x1ffffef, 25],
  [0xfffff4, 24], [0xfffff5, 24], [0x3ffffea, 26], [0x7ffff4, 23],
  [0x3ffffeb, 26], [0x7ffffe6, 27], [0x3ffffec, 26], [0x3ffffed, 26],
  [0x7ffffe7, 27], [0x7ffffe8, 27], [0x7ffffe9, 27], [0x7ffffea, 27],
  [0x7ffffeb, 27], [0xfffffffe, 28], [0x7ffffec, 27], [0x7ffffed, 27],
  [0x7ffffee, 27], [0x7ffffef, 27], [0x7fffff0, 27], [0x3ffffee, 26],
  [0x3fffffff, 30],
];

interface HuffNode {
  symbol: number;
  left: number;
  right: number;
}

let huffmanTree: HuffNode[] | null = null;

function buildHuffmanTree(): HuffNode[] {
  const nodes: HuffNode[] = [{ symbol: -1, left: -1, right: -1 }];

  for (let sym = 0; sym < HUFFMAN_CODES.length; sym++) {
    const [code, len] = HUFFMAN_CODES[sym];
    let idx = 0;

    for (let bitPos = len - 1; bitPos >= 0; bitPos--) {
      const bit = (code >> bitPos) & 1;
      let nextIdx: number;

      if (bit === 0) {
        if (nodes[idx].left === -1) {
          nextIdx = nodes.length;
          nodes.push({ symbol: -1, left: -1, right: -1 });
          nodes[idx].left = nextIdx;
        } else {
          nextIdx = nodes[idx].left;
        }
      } else {
        if (nodes[idx].right === -1) {
          nextIdx = nodes.length;
          nodes.push({ symbol: -1, left: -1, right: -1 });
          nodes[idx].right = nextIdx;
        } else {
          nextIdx = nodes[idx].right;
        }
      }

      if (bitPos === 0) {
        nodes[nextIdx].symbol = sym;
      } else {
        idx = nextIdx;
      }
    }
  }

  return nodes;
}

function huffmanDecode(data: Buffer): Buffer {
  if (!huffmanTree) {
    huffmanTree = buildHuffmanTree();
  }

  const tree = huffmanTree;
  const result: number[] = [];
  let nodeIdx = 0;

  for (let byteIdx = 0; byteIdx < data.length; byteIdx++) {
    let byte = data[byteIdx];
    for (let bit = 7; bit >= 0; bit--) {
      const b = (byte >> bit) & 1;
      const childIdx = b === 0 ? tree[nodeIdx].left : tree[nodeIdx].right;

      if (childIdx === -1) {
        throw new Error('QPACK Huffman decode error: invalid code');
      }

      const child = tree[childIdx];
      if (child.symbol !== -1) {
        if (child.symbol === 256) {
          throw new Error('QPACK Huffman decode error: unexpected EOS');
        }
        result.push(child.symbol);
        nodeIdx = 0;
      } else {
        nodeIdx = childIdx;
      }
    }
  }

  if (nodeIdx !== 0) {
    let cur = nodeIdx;
    let maxSteps = 30;
    while (tree[cur].symbol === -1 && maxSteps > 0) {
      const right = tree[cur].right;
      if (right === -1) {
        throw new Error('QPACK Huffman decode error: invalid padding');
      }
      cur = right;
      maxSteps--;
    }
    if (tree[cur].symbol !== 256) {
      throw new Error('QPACK Huffman decode error: padding is not EOS prefix');
    }
  }

  return Buffer.from(result);
}

/**
 * QPACK 编码器
 */
export class QPACKEncoder {
  private dynamicTable: Array<[string, string]> = [];
  private maxTableCapacity: number;
  private tableCapacity = 0;
  
  constructor(maxTableCapacity = 4096) {
    this.maxTableCapacity = maxTableCapacity;
  }
  
  /**
   * 编码 HTTP 头部
   * @param headers - HTTP 头部数组 [[name, value], ...]
   * @returns 编码后的字节数组
   */
  encode(headers: Array<[string, string]>): Buffer {
    const encodedHeaders: Buffer[] = [];
    
    for (const [name, value] of headers) {
      const lowerName = name.toLowerCase();
      
      // 1. 尝试在静态表中查找完全匹配
      const staticIndex = this.findInStaticTable(lowerName, value);
      if (staticIndex !== -1) {
        // 索引头部字段 (Indexed Field Line)
        encodedHeaders.push(this.encodeIndexed(staticIndex, false));
        continue;
      }
      
      // 2. 尝试在静态表中查找名称匹配
      const staticNameIndex = this.findNameInStaticTable(lowerName);
      if (staticNameIndex !== -1) {
        // 带名称引用的字面量 (Literal Field Line With Name Reference)
        encodedHeaders.push(this.encodeLiteralWithNameRef(staticNameIndex, value, false));
        continue;
      }
      
      // 3. 字面量头部字段 (Literal Field Line With Literal Name)
      encodedHeaders.push(this.encodeLiteralWithLiteralName(lowerName, value));
    }
    
    return Buffer.concat(encodedHeaders);
  }
  
  /**
   * 编码索引头部字段
   * @param index - 表索引
   * @param _isDynamic - 是否为动态表索引（预留参数）
   */
  private encodeIndexed(index: number, _isDynamic: boolean): Buffer {
    // 索引头部字段的格式: 1xxxxxxx
    // 最高位为1表示索引头部字段
    const prefix = 0x80; // 10000000
    return this.encodeInteger(index, prefix, 6);
  }
  
  /**
   * 编码带名称引用的字面量
   * @param nameIndex - 名称在表中的索引
   * @param value - 头部值
   * @param _isDynamic - 是否为动态表索引（预留参数）
   */
  private encodeLiteralWithNameRef(nameIndex: number, value: string, _isDynamic: boolean): Buffer {
    // 带名称引用的字面量格式: 01xxxxxx
    const prefix = 0x40; // 01000000
    const indexBytes = this.encodeInteger(nameIndex, prefix, 6);
    const valueBytes = this.encodeString(value);
    
    return Buffer.concat([indexBytes, valueBytes]);
  }
  
  /**
   * 编码带字面量名称的字面量
   * @param name - 头部名称
   * @param value - 头部值
   */
  private encodeLiteralWithLiteralName(name: string, value: string): Buffer {
    // 带字面量名称的字面量格式: 001xxxxx
    const prefix = 0x20; // 00100000
    const prefixByte = Buffer.from([prefix]);
    const nameBytes = this.encodeString(name);
    const valueBytes = this.encodeString(value);
    
    return Buffer.concat([prefixByte, nameBytes, valueBytes]);
  }
  
  /**
   * 编码整数（可变长度整数编码）
   * @param value - 要编码的整数
   * @param prefix - 前缀字节
   * @param prefixBits - 前缀位数
   */
  private encodeInteger(value: number, prefix: number, prefixBits: number): Buffer {
    const maxPrefix = (1 << prefixBits) - 1;
    
    if (value < maxPrefix) {
      return Buffer.from([prefix | value]);
    }
    
    const bytes: number[] = [prefix | maxPrefix];
    value -= maxPrefix;
    
    while (value >= 128) {
      bytes.push((value % 128) + 128);
      value = Math.floor(value / 128);
    }
    bytes.push(value);
    
    return Buffer.from(bytes);
  }
  
  /**
   * 编码字符串
   * @param str - 要编码的字符串
   * @param useHuffman - 是否使用 Huffman 编码（当前简化实现不使用）
   */
  private encodeString(str: string, useHuffman = false): Buffer {
    const strBuffer = Buffer.from(str, 'utf8');
    const lengthPrefix = useHuffman ? 0x80 : 0x00; // 最高位表示是否使用 Huffman
    const lengthBytes = this.encodeInteger(strBuffer.length, lengthPrefix, 7);
    
    return Buffer.concat([lengthBytes, strBuffer]);
  }
  
  /**
   * 在静态表中查找完全匹配的条目
   */
  private findInStaticTable(name: string, value: string): number {
    for (let i = 0; i < STATIC_TABLE.length; i++) {
      if (STATIC_TABLE[i][0] === name && STATIC_TABLE[i][1] === value) {
        return i;
      }
    }
    return -1;
  }
  
  /**
   * 在静态表中查找名称匹配的条目
   */
  private findNameInStaticTable(name: string): number {
    for (let i = 0; i < STATIC_TABLE.length; i++) {
      if (STATIC_TABLE[i][0] === name) {
        return i;
      }
    }
    return -1;
  }
}

/**
 * QPACK 解码器
 */
export class QPACKDecoder {
  private dynamicTable: Array<[string, string]> = [];
  private maxTableCapacity: number;
  
  constructor(maxTableCapacity = 4096) {
    this.maxTableCapacity = maxTableCapacity;
  }
  
  /**
   * 解码 HTTP 头部
   * @param encoded - 编码的字节数组
   * @returns 解码后的头部数组 [[name, value], ...]
   */
  decode(encoded: Buffer): Array<[string, string]> {
    const headers: Array<[string, string]> = [];
    let offset = 0;
    
    try {
      while (offset < encoded.length) {
        const firstByte = encoded[offset];
        
        // 索引头部字段 (1xxxxxxx)
        if ((firstByte & 0x80) === 0x80) {
          const { value: index, bytesRead } = this.decodeInteger(encoded, offset, 0x80, 7);
          offset += bytesRead;
          
          const entry = this.getTableEntry(index);
          if (entry) {
            headers.push(entry);
          }
        }
        // 带名称引用的字面量 (01xxxxxx)
        else if ((firstByte & 0xC0) === 0x40) {
          const { value: nameIndex, bytesRead: indexBytes } = this.decodeInteger(encoded, offset, 0x40, 6);
          offset += indexBytes;
          
          const { value: headerValue, bytesRead: valueBytes } = this.decodeString(encoded, offset);
          offset += valueBytes;
          
          const nameEntry = this.getTableEntry(nameIndex);
          if (nameEntry) {
            headers.push([nameEntry[0], headerValue]);
          }
        }
        // 带字面量名称的字面量 (001xxxxx)
        else if ((firstByte & 0xE0) === 0x20) {
          offset++; // 跳过前缀字节
          
          const { value: name, bytesRead: nameBytes } = this.decodeString(encoded, offset);
          offset += nameBytes;
          
          const { value: value, bytesRead: valueBytes } = this.decodeString(encoded, offset);
          offset += valueBytes;
          
          headers.push([name, value]);
        }
        // 其他类型（简化实现，跳过）
        else {
          logger.warn('Unknown QPACK field type', {}, { firstByte: firstByte.toString(16) });
          offset++;
        }
      }
    } catch (error) {
      logger.error('QPACK decode error', {}, error);
    }
    
    return headers;
  }
  
  /**
   * 解码整数
   */
  private decodeInteger(buffer: Buffer, offset: number, prefix: number, prefixBits: number): { value: number; bytesRead: number } {
    const maxPrefix = (1 << prefixBits) - 1;
    let value = buffer[offset] & maxPrefix;
    let bytesRead = 1;
    
    if (value < maxPrefix) {
      return { value, bytesRead };
    }
    
    let m = 0;
    let b: number;
    
    do {
      b = buffer[offset + bytesRead];
      bytesRead++;
      value += (b & 0x7F) * Math.pow(2, m);
      m += 7;
    } while ((b & 0x80) === 0x80 && offset + bytesRead < buffer.length);
    
    return { value, bytesRead };
  }
  
  /**
   * 解码字符串
   */
  private decodeString(buffer: Buffer, offset: number): { value: string; bytesRead: number } {
    const firstByte = buffer[offset];
    const useHuffman = (firstByte & 0x80) === 0x80;
    
    const { value: length, bytesRead: lengthBytes } = this.decodeInteger(buffer, offset, 0x80, 7);
    const totalBytesRead = lengthBytes + length;
    
    const stringBuffer = buffer.slice(offset + lengthBytes, offset + lengthBytes + length);
    
    const decodedBuffer = useHuffman ? huffmanDecode(stringBuffer) : stringBuffer;
    const value = decodedBuffer.toString('utf8');
    return { value, bytesRead: totalBytesRead };
  }
  
  /**
   * 从表中获取条目
   */
  private getTableEntry(index: number): [string, string] | null {
    if (index < STATIC_TABLE.length) {
      return STATIC_TABLE[index];
    }
    
    const dynamicIndex = index - STATIC_TABLE.length;
    if (dynamicIndex < this.dynamicTable.length) {
      return this.dynamicTable[dynamicIndex];
    }
    
    return null;
  }
}

