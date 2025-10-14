module.exports = {
  name: "nodeapp", // Name of your application
  script: "index.js", // Entry point of your application
  exec_mode : "cluster",
  instances : "3",
  log_file: './nodeapp.log',
};