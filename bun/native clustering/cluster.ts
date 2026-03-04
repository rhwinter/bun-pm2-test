import cluster from "node:cluster";
import { cpuIntensiveWork } from "../../cpuIntensiveWork";
import homepage from "../../index.html";

const NUM_WORKERS = 3;

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
  const server = Bun.serve({
    port: 5555,
    development: false,
    reusePort: true,
    routes: {
      "/": homepage,
      "/api": async (request) => {
        const url = new URL(request.url);
        const id = Object.fromEntries(url.searchParams).req;

        console.log(`Request ${id} received by worker ${process.pid} (instance ${process.env.NODE_APP_INSTANCE})`);

        const start = Date.now();
        cpuIntensiveWork(1000);
        const duration = Date.now() - start;

        return new Response(
          `Request ${id} was resolved by bunapp-${process.env.NODE_APP_INSTANCE} and took ${duration}ms to complete`
        );
      },
    },
  });

  console.log(`Worker ${process.pid} (instance ${process.env.NODE_APP_INSTANCE}) listening on ${server.url}`);
}
