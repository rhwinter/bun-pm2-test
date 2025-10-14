import express from "express";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { cpuIntensiveWork } from "../cpuIntensiveWork.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = 5556;

app.get("/", (_req, res) => {
  const html = readFileSync(join(__dirname, "../index.html"), "utf-8");
  res.send(html);
});

app.get("/api", async (req, res) => {
  const id = req.query.req;
  console.log(`Request ${id} received by '${process.env.name}-${process.env.NODE_APP_INSTANCE}'`);
  
  const start = Date.now();
  cpuIntensiveWork(1000); // Simulate CPU work for 1 seconds
  const duration = Date.now() - start;
  
  res.send(`Request ${id} was resolved by ${process.env.name}-${process.env.NODE_APP_INSTANCE} and took ${duration}ms to complete`);
});

app.listen(port, () => {
  console.log(`Listening on http://localhost:${port}`);
});