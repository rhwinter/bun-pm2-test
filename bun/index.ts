
import { cpuIntensiveWork } from "../cpuIntensiveWork";
import homepage from "../index.html";

const isBm2 = process.env.manager === "bm2";

const server = Bun.serve({
  port: process.env.port ? parseInt(process.env.port) : 5555,
  development: false,
  reusePort: true,
  routes:{
    "/": homepage,
    "/api": async (request) => {
      const url = new URL(request.url);
      const id = Object.fromEntries(url.searchParams).req;
      
      console.log(`Request ${id} received by '${process.env.name}-${isBm2 ? process.env.BM2_INSTANCE_ID : process.env.NODE_APP_INSTANCE}'`);

      const start = Date.now();
      cpuIntensiveWork(1000);
      const duration = Date.now() - start;

      return new Response(`Request ${id} was resolved by ${process.env.name}-${isBm2 ? process.env.BM2_INSTANCE_ID : process.env.NODE_APP_INSTANCE} and took ${duration}ms to complete`);
    },
  },
});


console.log(`Listening on ${server.url}`);