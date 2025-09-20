const { getPool } = require('./db/dbConfig');

async function connectDB() {
  return getPool();
}

module.exports = connectDB; 