const NUM_WORKERS = 3;

const workers = Array.from({ length: NUM_WORKERS }, (_, i) =>
  Bun.spawn(["bun", "index.ts"], {
    env: {
      ...process.env,
      name: "bunapp",
      port: "5555",
      NODE_APP_INSTANCE: String(i),
      manager: "custom",
    },
    stdout: "inherit",
    stderr: "inherit",
  })
);

console.log(`Started ${NUM_WORKERS} workers`);

process.on("SIGINT", () => {
  workers.forEach(w => w.kill());
  process.exit();
});

await Promise.all(workers.map(w => w.exited));
