export function normalizeGitOrigin(value: string | undefined): string {
  if (!value) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error();
    return url.origin;
  } catch {
    throw new Error('MIRROR_GIT_BASE_URL must be an HTTPS origin without credentials, path, query or fragment');
  }
}
