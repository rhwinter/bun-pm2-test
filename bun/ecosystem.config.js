module.exports = {
  name: "bunapp", // Name of your application
  script: "index.ts", // Entry point of your application
  interpreter: "bun", // Bun interpreter
  exec_mode : "cluster",
  instances : "3",
  log_file: './bunapp.log',
};