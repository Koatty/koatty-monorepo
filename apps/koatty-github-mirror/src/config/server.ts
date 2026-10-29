export default {
  hostname: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 3000),
  protocol: "http",
  trace: false,
};
