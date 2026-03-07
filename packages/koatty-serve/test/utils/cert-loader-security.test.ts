import { loadCertificate, isCertificateContent } from '../../src/utils/cert-loader';

describe('CertLoader Security', () => {
  describe('sanitizeCertPath', () => {
    it('should throw error for path traversal attack with ..', () => {
      expect(() => {
        loadCertificate('../../etc/passwd', 'test');
      }).toThrow('path traversal');
    });

    it('should throw error for null byte injection', () => {
      expect(() => {
        loadCertificate('/etc/passwd\0.txt', 'test');
      }).toThrow('null byte injection');
    });

    it('should throw error for path traversal with multiple ..', () => {
      expect(() => {
        loadCertificate('../../../etc/passwd', 'test');
      }).toThrow('path traversal');
    });

    it('should throw error for absolute path with ..', () => {
      expect(() => {
        loadCertificate('/var/www/../../../etc/passwd', 'test');
      }).toThrow('path traversal');
    });
  });

  describe('isCertificateContent', () => {
    it('should return true for certificate content', () => {
      const cert = '-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----';
      expect(isCertificateContent(cert)).toBe(true);
    });

    it('should return true for private key content', () => {
      const key = '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----';
      expect(isCertificateContent(key)).toBe(true);
    });

    it('should return true for RSA private key content', () => {
      const key = '-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----';
      expect(isCertificateContent(key)).toBe(true);
    });

    it('should return true for EC private key content', () => {
      const key = '-----BEGIN EC PRIVATE KEY-----\ntest\n-----END EC PRIVATE KEY-----';
      expect(isCertificateContent(key)).toBe(true);
    });

    it('should return false for file path', () => {
      expect(isCertificateContent('/path/to/cert.pem')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isCertificateContent('')).toBe(false);
    });

    it('should return false for null', () => {
      expect(isCertificateContent(null as any)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isCertificateContent(undefined as any)).toBe(false);
    });
  });

  describe('loadCertificate with certificate content', () => {
    it('should skip path check for certificate content', () => {
      const cert = '-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----';
      const result = loadCertificate(cert, 'test');
      expect(result).toBe(cert);
    });

    it('should skip path check for private key content', () => {
      const key = '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----';
      const result = loadCertificate(key, 'test');
      expect(result).toBe(key);
    });

    it('should skip path check for public key content', () => {
      const key = '-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----';
      const result = loadCertificate(key, 'test');
      expect(result).toBe(key);
    });
  });
});
