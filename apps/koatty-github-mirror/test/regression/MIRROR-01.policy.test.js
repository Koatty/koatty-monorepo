const { parseTarget, validateRedirect } = require('../../dist/utils/policy');
const { isPublicAddress } = require('../../dist/utils/transport');
const { AdmissionService } = require('../../dist/service/AdmissionService');
const { defaults, settingsFromEnv } = require('../../dist/utils/settings');

describe('target policy and resource admission', () => {
  test.each([
    'https://github.com/Koatty/koatty.git',
    'github.com/Koatty/koatty.git',
    'https://github.com/Koatty/koatty.git/info/refs?service=git-upload-pack',
    'https://github.com/Koatty/koatty.git/git-upload-pack',
    'https://github.com/Koatty/koatty.git/git-receive-pack',
    'https://github.com/Koatty/koatty.git/info/refs?service=git-receive-pack',
  ])('accepts Git read target %s', value => expect(parseTarget(value).kind).toBe('git'));
  test.each([
    'https://github.com/a/b/releases/download/v1/app.tar.gz',
    'https://github.com/a/b/releases/latest/download/app.zip',
    'https://github.com/a/b/archive/refs/heads/main.zip',
    'https://raw.githubusercontent.com/a/b/main/README.md',
    'https://codeload.github.com/a/b/zip/refs/heads/main',
  ])('accepts file target %s', value => expect(parseTarget(value).kind).toBe('file'));
  test('converts blob URLs to actual raw content', () => expect(parseTarget('https://github.com/a/b/blob/main/readme.md').url.href).toBe('https://raw.githubusercontent.com/a/b/main/readme.md'));
  test.each([
    'http://github.com/a/b.git', 'https://github.com.evil.test/a/b.git',
    'https://127.0.0.1/a/b.git', 'https://github.com@127.0.0.1/a/b.git',
    'https://user:password@github.com/a/b.git', 'https://github.com:8443/a/b.git',
    'https://github.com/a/b.git#fragment', 'https://github.com/a/b.git/info/refs?service=git-delete-pack',
    'https://github.com/a/b.git/git-delete-pack', 'https://github.com/a/b',
    'https://github.com/a/b.git/../secrets', 'https://github.com/a/b/blob/main/a%2Fb',
    'https://api.github.com/repos/a/b', 'https://github.com\\@127.0.0.1/a/b',
  ])('rejects unsupported/ambiguous targets %s', value => expect(() => parseTarget(value)).toThrow());
  test.each(['127.0.0.1','10.0.0.1','169.254.169.254','192.168.1.1','172.16.0.1','100.64.0.1','0.0.0.0','224.0.0.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1','2001:db8::1'])('rejects non-public DNS answer %s', value => expect(isPublicAddress(value)).toBe(false));
  test('allows public DNS answers', () => { expect(isPublicAddress('140.82.112.3')).toBe(true); expect(isPublicAddress('2606:50c0:8000::154')).toBe(true); });
  test('redirects validate scheme, port, hostname and resource kind', () => {
    expect(() => validateRedirect(new URL('https://release-assets.githubusercontent.com/a/file?signature=example'), 'file')).not.toThrow();
    for (const value of ['http://github.com/a/b.git','https://127.0.0.1/test','https://evil.test/test','https://release-assets.githubusercontent.com:8443/file']) expect(() => validateRedirect(new URL(value),'file')).toThrow();
    expect(() => validateRedirect(new URL('https://release-assets.githubusercontent.com/file'),'git')).toThrow();
  });
  test('admission limits do not leak slots after release', () => {
    const admission = new AdmissionService(); const config = {...defaults,maxConcurrent:2,maxPerClient:1};
    const a = admission.acquire('a',config); expect(() => admission.acquire('a',config)).toThrow();
    const b = admission.acquire('b',config); expect(() => admission.acquire('c',config)).toThrow();
    a(); a(); const c = admission.acquire('c',config); b(); c(); expect(admission.active).toBe(0);
  });
  test('admission rejects request bursts after releasing connections', () => {
    const admission = new AdmissionService(); const config = {...defaults,requestsPerMinute:1};
    admission.acquire('a',config)(); expect(() => admission.acquire('a',config)).toThrow();
  });
  test('invalid config fails closed without printing its value', () => {
    expect(() => settingsFromEnv({MIRROR_MAX_CONCURRENT:'not-valid'})).toThrow('MIRROR_MAX_CONCURRENT');
  });
});
