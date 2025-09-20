require('dotenv').config();  // Load .env first
const sql = require('mssql');

const config = {
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  server: process.env.SQL_SERVER,
  database: process.env.SQL_DATABASE,
  port: 1433,
  options: {
    encrypt: true,                // Required for Azure
    trustServerCertificate: false
  },
  connectionTimeout: 30000,       // 30 sec
  requestTimeout: 30000
};

let poolPromise;

function getPool() {
  if (!poolPromise) {
    console.log("Connecting to Azure SQL with config:", {
      user: config.user,
      server: config.server,
      database: config.database
    });

    poolPromise = sql.connect(config)
      .then(pool => {
        console.log("✅ Connected to Azure SQL successfully!");
        return pool;
      })
      .catch(err => {
        poolPromise = undefined; // reset so next call can retry
        console.error("❌ SQL Connection Error:", err.message);
        throw err;
      });
  }
  return poolPromise;
}

module.exports = { getPool, sql };
