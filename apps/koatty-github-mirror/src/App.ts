import { Koatty, Bootstrap } from "koatty";
import * as path from 'path';

@Bootstrap()
export class App extends Koatty {
  public init() {
    this.rootPath = path.dirname(__dirname);
    // Enable only behind the bundled Caddy. The application port is not published.
    if (process.env.TRUST_PROXY === 'true') {
      this.proxy = true;
      this.proxyIpHeader = 'X-Real-IP';
      this.maxIpsCount = 1;
    }
  }
}
