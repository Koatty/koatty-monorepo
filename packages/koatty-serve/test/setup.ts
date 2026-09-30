import { generateTestCertificates } from './utils/cert-generator';
import { TerminusManager } from '../src/utils/terminus';
generateTestCertificates();
// The jest worker owns the process: a suite whose graceful-shutdown path runs
// with exitOnShutdown enabled would terminate the worker mid-run (observed on
// CI as "jest worker crashed ... exitCode=0"). Tests that assert the exit
// behaviour opt back in explicitly on their own manager instance.
TerminusManager.getInstance().setExitOnShutdown(false);
// Tests own the resources they create. Do not mask leaks with forced exit,
// global fake intervals or removal of unrelated process listeners.
afterEach(() => {
  TerminusManager.resetInstance();
  TerminusManager.getInstance().setExitOnShutdown(false);
  jest.restoreAllMocks();
});
