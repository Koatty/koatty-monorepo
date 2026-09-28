import { generateTestCertificates } from './utils/cert-generator';
import { TerminusManager } from '../src/utils/terminus';
generateTestCertificates();
// Tests own the resources they create. Do not mask leaks with forced exit,
// global fake intervals or removal of unrelated process listeners.
afterEach(() => { TerminusManager.resetInstance(); jest.restoreAllMocks(); });
