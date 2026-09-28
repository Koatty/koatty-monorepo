import { KoattyApplication } from "koatty_core";
import { HttpsServerOptions } from "../config/config";
import { HttpServer } from "./http";

export class HttpsServer extends HttpServer {
  constructor(app: KoattyApplication, options: HttpsServerOptions) {
    super(app, options, "https");
  }
}
