const db_host = process.env.DB_HOST;
const db_pw = process.env.DB_PW;
const db_user = process.env.DB_USER;
const db_name = process.env.DB_NAME;
const db_port = process.env.DB_PORT;
const db_dialect = process.env.DB_DIALECT || "mysql";
const db_ssl = process.env.DB_SSL === "true";

module.exports = {
  HOST: db_host,
  USER: db_user,
  PASSWORD: db_pw,
  DB: db_name,
  PORT: db_port,
  dialect: db_dialect,
  ssl: db_ssl,
  pool: {
    max: 5,
    min: 0,
    acquire: 30000,
    idle: 10000,
  },
};
