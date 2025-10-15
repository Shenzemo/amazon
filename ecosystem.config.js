// latest/backend/ecosystem.config.js
module.exports = {
  apps : [{
    name   : "server",
    script : "./server.js",
    env: {
      NODE_ENV: "production",
      ...require('dotenv').config({ path: './.env' }).parsed
    }
  }]
}
