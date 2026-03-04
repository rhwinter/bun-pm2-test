import { cpuIntensiveWork } from "../../cpuIntensiveWork";
import homepage from "../../index.html";

const BASE_PORT = 5556;
const instance = parseInt(process.env.NODE_APP_INSTANCE ?? "0");
const port = BASE_PORT + instance;

const server = Bun.serve({
  port,
  development: false,
  routes: {
    "/": homepage,
    "/api": async (request) => {
      const url = new URL(request.url);
      const id = Object.fromEntries(url.searchParams).req;

      console.log(`Request ${id} received by 'bunapp-${instance}'`);

      const start = Date.now();
      cpuIntensiveWork(1000);
      const duration = Date.now() - start;

      return new Response(
        `Request ${id} was resolved by bunapp-${instance} and took ${duration}ms to complete`,
      );
    },
  },
});

console.log(`Worker ${instance} listening on ${server.url}`);
