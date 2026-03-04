import cluster from "node:cluster";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import express from "express";
import { cpuIntensiveWork } from "../cpuIntensiveWork.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const NUM_WORKERS = 3;
const PORT = 5556;

if (cluster.isPrimary) {
  console.log(`Primary ${process.pid} running, forking ${NUM_WORKERS} workers`);

  for (let i = 0; i < NUM_WORKERS; i++) {
    cluster.fork({ NODE_APP_INSTANCE: String(i) });
  }

  cluster.on("exit", (worker) => {
    console.log(`Worker ${worker.process.pid} died, restarting...`);
    cluster.fork();
  });
} else {
  const app = express();

  app.get("/", (_req, res) => {
    const html = readFileSync(join(__dirname, "../index.html"), "utf-8");
    res.send(html);
  });

  app.get("/api", (req, res) => {
    const id = req.query.req;
    console.log(`Request ${id} received by worker ${process.pid} (instance ${process.env.NODE_APP_INSTANCE})`);

    const start = Date.now();
    cpuIntensiveWork(1000);
    const duration = Date.now() - start;

    res.send(`Request ${id} was resolved by nodeapp-${process.env.NODE_APP_INSTANCE} and took ${duration}ms to complete`);
  });

  app.listen(PORT, () => {
    console.log(`Worker ${process.pid} (instance ${process.env.NODE_APP_INSTANCE}) listening on http://localhost:${PORT}`);
  });
}
