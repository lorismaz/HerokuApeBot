module.exports = {
  apps: [{
    name: "pcs_listener",
    script: "./pcs_listener.js P",
    instances: "1",
    env: {
      NODE_ENV: "development",
    },
    env_production: {
      NODE_ENV: "production",
    }
  }]
}
