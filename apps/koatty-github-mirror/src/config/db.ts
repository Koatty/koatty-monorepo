export default {
  type: "mysql",
  host: "127.0.0.1",
  port: 3306,
  username: "root",
  password: "",
  database: "koatty-github-mirror",
  synchronize: false,
  logging: false,
  entities: ["dist/model/**/*.js"],
};
