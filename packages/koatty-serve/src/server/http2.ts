import { KoattyApplication } from "koatty_core";
import { Http2ServerOptions } from "../config/config";
import { HttpServer } from "./http";

export class Http2Server extends HttpServer {
  constructor(app: KoattyApplication, options: Http2ServerOptions) {
    super(app, options, "http2");
  }
}
