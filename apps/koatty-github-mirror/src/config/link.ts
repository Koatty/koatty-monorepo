import { normalizeGitOrigin } from '../utils/gitOrigin';

export default { gitOrigin: normalizeGitOrigin(process.env.MIRROR_GIT_BASE_URL) };
