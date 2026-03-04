module.exports = {
  name: "bunapp-fork",
  script: "index.ts",
  interpreter: "bun",
  exec_mode: "fork",
  instances: 3,
  log_file: "./bunapp-fork.log",
  env: {
    manager: "pm2-fork",
  },
};
