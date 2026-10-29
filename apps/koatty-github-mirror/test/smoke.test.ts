import { createTestApp, createHttpTest } from 'koatty_testing';
import { Koatty } from 'koatty';
import * as path from 'path';

// npm test builds first. Never import the auto-starting @Bootstrap entry here.
class TestApp extends Koatty {
  public init() { this.rootPath = process.cwd(); this.appPath = path.join(process.cwd(), 'dist'); }
}

describe('koatty-github-mirror', () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;
  beforeAll(async () => { app = await createTestApp(TestApp); });
  afterAll(async () => { await app?.stop(); });
  it('loads the controller and serves its real route', async () => {
    const response = await createHttpTest(app.app).get('/');
    expect(response.status).toBe(200);
    expect(response.text).toContain('Git 版本控制');
    expect(response.headers['content-type']).toContain('text/html');
  });
});
