import { NewServe, SingleProtocolServer } from "../src/index";
import { KoattyApplication } from "koatty_core";

// Mock KoattyApplication
class MockKoattyApplication {
  callback = () => (_req: any, res: any) => res.end();
  on = jest.fn();
  emit = jest.fn();
  config(key?: string, defaultValue?: any) {
    return defaultValue;
  }
}

describe("NewServe", () => {
  let app: KoattyApplication;
  const servers: any[] = [];
  afterEach(async () => { for (const server of servers.splice(0)) await new Promise<void>((resolve, reject) => server.Stop((err: Error) => err ? reject(err) : resolve())); });

  beforeEach(() => {
    app = new MockKoattyApplication() as unknown as KoattyApplication;
  });

  it("should create single protocol server with default HTTP protocol", () => {
    const server = NewServe(app);
    servers.push(server);
    expect(server).toBeInstanceOf(SingleProtocolServer);
    expect(server.options.protocol).toBe("http");
  });

  it("should create single protocol server with HTTPS protocol", () => {
    const server = NewServe(app, { 
      protocol: "https",
      hostname: "127.0.0.1",
      port: 3000,
      ext: {
        keyFile: "test/temp/test-key.pem",
        crtFile: "test/temp/test-cert.pem"
      }
    });
    servers.push(server);
    expect(server).toBeInstanceOf(SingleProtocolServer);
    expect(server.options.protocol).toBe("https");
  });

  it("should create single protocol server with HTTP2 protocol", () => {
    const server = NewServe(app, { 
      protocol: "http2",
      hostname: "127.0.0.1",
      port: 3000,
      ext: {
        keyFile: "test/temp/test-key.pem",
        crtFile: "test/temp/test-cert.pem"
      }
    });
    servers.push(server);
    expect(server).toBeInstanceOf(SingleProtocolServer);
    expect(server.options.protocol).toBe("http2");
  });

  it("should create single protocol server with WebSocket protocol", () => {
    const server = NewServe(app, { 
      protocol: "ws",
      hostname: "127.0.0.1",
      port: 3000
    });
    servers.push(server);
    expect(server).toBeInstanceOf(SingleProtocolServer);
    expect(server.options.protocol).toBe("ws");
  });

  it("should create single protocol server with gRPC protocol", () => {
    const server = NewServe(app, { 
      protocol: "grpc",
      hostname: "127.0.0.1",
      port: 3000
    });
    servers.push(server);
    expect(server).toBeInstanceOf(SingleProtocolServer);
    expect(server.options.protocol).toBe("grpc");
  });
});
