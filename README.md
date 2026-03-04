# Bun clustering (native, pm2 and bm2)

- [Bun clustering (native, pm2 and bm2)](#bun-clustering-native-pm2-and-bm2)
  - [Description](#description)
  - [node+pm2 clustering](#nodepm2-clustering)
  - [Bun + pm2-beta and bm2](#bun--pm2-beta-and-bm2)
  - [Native Bun clustering (without pm2/bm2)](#native-bun-clustering-without-pm2bm2)
    - [`cluster-runner.ts` — `Bun.spawn` + `SO_REUSEPORT`](#cluster-runnerts--bunspawn--so_reuseport)
    - [`cluster.ts` — `node:cluster`](#clusterts--nodecluster)
    - [Results on macOS](#results-on-macos)
    - [Ruling out browser keep-alive](#ruling-out-browser-keep-alive)
    - [Results on Linux](#results-on-linux)
  - [Native Node clustering (without pm2)](#native-node-clustering-without-pm2)
  - [Root cause analysis](#root-cause-analysis)
    - [Why macOS fails entirely](#why-macos-fails-entirely)
    - [Why Linux only partially works](#why-linux-only-partially-works)
    - [Why `node:cluster` is unreliable](#why-nodecluster-is-unreliable)
    - [Summary](#summary)
  - [Running](#running)
    - [Not clustered](#not-clustered)
    - [Clustering with native scripts](#clustering-with-native-scripts)
    - [Clustering with pm2](#clustering-with-pm2)
    - [Clustering with bm2](#clustering-with-bm2)
    - [Recommended: pm2 fork mode + nginx (working solution for Bun)](#recommended-pm2-fork-mode--nginx-working-solution-for-bun)
  - [Bun source code analysis](#bun-source-code-analysis)
    - [How Node's `node:cluster` round-robin is supposed to work](#how-nodes-nodecluster-round-robin-is-supposed-to-work)
    - [The bug: `Bun.serve()` bypasses `cluster._getServer()`](#the-bug-bunserve-bypasses-cluster_getserver)
    - [The `SO_REUSEPORT` auto-enable masks the problem](#the-so_reuseport-auto-enable-masks-the-problem)
    - [The occasional correct distribution on Linux explained](#the-occasional-correct-distribution-on-linux-explained)
    - [IPC handle transfer is completely unimplemented in Bun](#ipc-handle-transfer-is-completely-unimplemented-in-bun)
    - [What a proper fix requires](#what-a-proper-fix-requires)


## Description

This repository demonstrates that clustering with Bun and pm2/bm2 doesn't work as expected.

The setup is very simple: a bare server responds to requests made to `/api`, where a `cpuIntensiveWork()` call is made. `cpuIntensiveWork()` blocks that server's app for 1s at 100% CPU. When another request is made to the same endpoint, the load balancer should route the request to the next available cluster instance (three are available).

A simple HTML page is served by the same server under `/`, it simply fires three simultaneous requests to `/api`, which should all resolve in ~1s (indicating each instance of the cluster received each request separately and responded in parallel). Requests completing sequentially at 1s, 2s, 3s indicate that all requests are being handled by the same instance.

## node+pm2 clustering

A node application running under `pm2` is clustered as expected, routing requests to each instance:
* Request 2, fetch completed in 1007ms: Request 2 was resolved by nodeapp-2 and took 1001ms to complete
* Request 1, fetch completed in 1008ms: Request 1 was resolved by nodeapp-1 and took 1001ms to complete
* Request 3, fetch completed in 1015ms: Request 3 was resolved by nodeapp-0 and took 1000ms to complete

## Bun + pm2-beta and bm2

Both `pm2-beta` and `bm2` fail to properly cluster and route the requests:
* Request 1, fetch completed in 1005ms: Request 1 was resolved by undefined-0 and took 1000ms to complete
* Request 2, fetch completed in 2005ms: Request 2 was resolved by undefined-0 and took 1000ms to complete
* Request 3, fetch completed in 3004ms: Request 3 was resolved by undefined-0 and took 1000ms to complete

These are the same results one gets when running the server unclustered.

## Native Bun clustering (without pm2/bm2)

To rule out pm2/bm2 as the cause, two custom clustering scripts were written for Bun.

### `cluster-runner.ts` — `Bun.spawn` + `SO_REUSEPORT`

Spawns N worker processes directly using `Bun.spawn()`. Since `Bun.serve()` uses `reusePort: true`, all workers bind to the same port and rely on the OS kernel to distribute incoming connections via `SO_REUSEPORT`.

Run with:
```
cd bun
bun "native clustering/cluster-runner.ts"
```
navigate to `http://localhost:5555`.

### `cluster.ts` — `node:cluster`

Uses Bun's implementation of Node.js's `node:cluster` module, which is supposed to run a primary process that accepts all connections and distributes them to workers via IPC in round-robin.

Run with:
```
cd bun
bun "native clustering/cluster.ts"
```
navigate to `http://localhost:5555`.

### Results on macOS

Both approaches fail completely — all requests are handled by the same instance:

```
$ bun "native clustering/cluster-runner.ts"
Started 3 workers
Request 1 received by 'bunapp-1'
Request 2 received by 'bunapp-1'
Request 3 received by 'bunapp-1'

$ bun "native clustering/cluster.ts"
Primary 73257 running, forking 3 workers
Request 1 received by worker 73260 (instance 2)
Request 2 received by worker 73260 (instance 2)
Request 3 received by worker 73260 (instance 2)
```

### Ruling out browser keep-alive

An initial hypothesis was that the browser might be reusing a single TCP connection for all 3 requests (HTTP keep-alive), causing them to be handled sequentially by the same instance. Two things were investigated:

1. **`Connection: close` header**: `index.html` sends this header with each fetch to hint the server to close the connection after each response. However, `Connection` is a [forbidden header name](https://fetch.spec.whatwg.org/#forbidden-header-name) per the Fetch spec — browsers silently drop it, so it has no effect.

2. **Terminal requests**: To bypass the browser entirely, the same 3 simultaneous requests were made from separate terminal tabs using `curl`. The results were identical — all requests still went to the same instance.

This ruled out browser connection reuse as the cause. The issue is in how the OS and Bun distribute connections across workers.

### Results on Linux

`cluster-runner.ts` distributes requests across multiple workers, but unevenly. Over 10+ runs, the pattern is **consistent**: hash collisions reliably send 2 requests to one worker and 1 to another, leaving the third worker idle:

```
$ bun "native clustering/cluster-runner.ts"
Started 3 workers
Request 1 received by 'bunapp-0'
Request 3 received by 'bunapp-1'
Request 2 received by 'bunapp-0'   ← should have gone to bunapp-2
```

In the browser this shows up as request 2 completing in 2s instead of 1s, because it had to wait behind request 1 on the same worker.

`cluster.ts` (`node:cluster`) behaves differently from `cluster-runner.ts` on Linux. Over 10+ runs it **sometimes** distributes all 3 requests to 3 separate workers correctly, and sometimes exhibits the same collision pattern:

```
$ bun "native clustering/cluster.ts"
Primary 2658669 running, forking 3 workers
Request 3 received by worker 2658683 (instance 1)
Request 1 received by worker 2658681 (instance 0)
Request 2 received by worker 2658681 (instance 0)   ← should have gone to instance 2
```

The occasional correct distribution suggests Bun's `node:cluster` does implement some form of master-side distribution, but it is not reliable — unlike Node.js's `SCHED_RR` which distributes correctly on every run.

## Native Node clustering (without pm2)

As a control, the same `node:cluster` approach was implemented for Node in [`node+npm/cluster.js`](node+npm/cluster.js). Unlike [`bun/native clustering/cluster.ts`](bun/native%20clustering/cluster.ts), this runs on real Node.js where `SCHED_RR` is fully implemented.

Run with:
```
cd node+npm
node cluster.js
```
navigate to `http://localhost:5556`.

Results are consistent across all runs — every request goes to a separate worker and all complete in ~1s:
* Request 1, fetch completed in 1007ms: Request 1 was resolved by nodeapp-0 and took 1000ms to complete
* Request 2, fetch completed in 1014ms: Request 2 was resolved by nodeapp-2 and took 1001ms to complete
* Request 3, fetch completed in 1014ms: Request 3 was resolved by nodeapp-1 and took 1001ms to complete

This confirms that the issue is specific to Bun's `node:cluster` implementation, not to the test setup.

## Root cause analysis

### Why macOS fails entirely

On macOS (BSD-derived), `SO_REUSEPORT` allows multiple sockets to bind to the same port but **does not distribute connections across them**. All connections go to whichever socket calls `accept()` first. When 3 requests arrive in rapid succession, the same worker accepts all 3 from its queue before its event loop gets blocked by `cpuIntensiveWork`.

### Why Linux only partially works

On Linux, `SO_REUSEPORT` was specifically designed for load balancing: the kernel hashes each connection's 4-tuple `(src_ip, src_port, dst_ip, dst_port)` and maps it to one of the listening sockets. This distributes connections, but the distribution is **hash-based, not round-robin**. With only 3 simultaneous connections, hash collisions are common — two connections can easily hash to the same worker, leaving another worker idle.

### Why `node:cluster` is unreliable

In real Node.js, the `cluster` module uses `SCHED_RR` (round-robin) by default on non-Windows: the primary process owns the single listening socket, accepts every connection itself, and hands the socket fd to workers in strict rotation — one per worker, no hashing. This is why Node + pm2 achieves perfect distribution on every run.

Bun's `node:cluster` is only partially implemented. On macOS it falls back entirely to `SO_REUSEPORT`. On Linux it sometimes distributes correctly across all workers, but is not reliable — suggesting the master-side distribution logic exists but has a race or timing issue that allows connections to bypass it.

### Summary

| Approach | Mechanism | macOS | Linux |
|---|---|---|---|
| Node + pm2 cluster | Master accepts + round-robin IPC | ✅ All 3 workers, ~1s each | ✅ All 3 workers, ~1s each |
| Node `cluster.js` (native) | Master accepts + round-robin IPC | ✅ All 3 workers, ~1s each | ✅ All 3 workers, ~1s each |
| Bun + pm2-beta cluster | SO_REUSEPORT | ❌ 1 worker, sequential | ⚠️ Hash-based, consistent collisions |
| Bun + bm2 cluster | SO_REUSEPORT | ❌ 1 worker, sequential | ⚠️ Hash-based, consistent collisions |
| Bun `cluster-runner.ts` | SO_REUSEPORT | ❌ 1 worker, sequential | ⚠️ Hash-based, consistent collisions |
| Bun `cluster.ts` (node:cluster) | Partial master + SO_REUSEPORT fallback | ❌ 1 worker, sequential | ⚠️ Correct distribution sometimes, collisions other times |

The fix needs to be in Bun's `node:cluster` implementation: the primary process must reliably own the listening socket and distribute connections to workers in round-robin on every run, rather than falling back to `SO_REUSEPORT`.

## Running

### Not clustered

The **Bun** version:
```
cd bun
bun index.ts
```
navigate to `http://localhost:5555`.

The **node** version is more or less the same:
```
cd node+npm
node index.js
```
navigate to `http://localhost:5556`.

### Clustering with native scripts

The **Bun** versions:
```
cd bun
bun "native clustering/cluster-runner.ts"   # Bun.spawn + reusePort approach
bun "native clustering/cluster.ts"          # node:cluster approach
```
navigate to `http://localhost:5555`.

The **node** version:
```
cd node+npm
node cluster.js         # node:cluster approach
```
navigate to `http://localhost:5556`.

### Clustering with pm2

The **Bun** version:
```
cd bun
npm -g uninstall pm2
bun -g install pm2-beta
pm2 update
pm2 start ecosystem.config.js
```
navigate to `http://localhost:5555`.

Compare the results with the **node** version:
```
pm2 delete all
bun -g uninstall pm2-beta
npm -g install pm2
pm2 update
cd node+npm
pm2 start ecosystem.config.cjs
```
navigate to `http://localhost:5556`.

### Clustering with bm2

```
cd bun
bun -g install bm2
bm2 start bm2.ecosystem.config.ts
```
navigate to `http://localhost:5557`.

### Recommended: pm2 fork mode + nginx (working solution for Bun)

Since pm2 cluster mode is broken for Bun (see root cause analysis below), the correct approach is to run each Bun instance as an independent process on its own port (**fork mode**) and put nginx in front as the actual load balancer.

All three files live under [`bun/forking/`](bun/forking/):

**[`bun/forking/index.ts`](bun/forking/index.ts)** — A copy of `index.ts` adapted for fork mode. Instead of relying on `SO_REUSEPORT`, each instance binds a dedicated port derived from `NODE_APP_INSTANCE` (set automatically by pm2):
```typescript
const BASE_PORT = 5556;
const instance = parseInt(process.env.NODE_APP_INSTANCE ?? "0");
const port = BASE_PORT + instance;
```
With 3 instances, workers listen on ports 5556, 5557, and 5558.

**[`bun/forking/ecosystem.config.cjs`](bun/forking/ecosystem.config.cjs)** — pm2 ecosystem config using `exec_mode: "fork"` and 3 instances. Uses `.cjs` extension with `module.exports` syntax. pm2 must be invoked from inside `bun/forking/` so that `script: "index.ts"` resolves correctly — pm2 resolves script paths relative to the working directory where it is invoked, not relative to the config file.

**[`bun/forking/nginx.conf`](bun/forking/nginx.conf)** — nginx upstream config that load balances across the three worker ports using `least_conn`, the correct strategy when response times vary significantly (e.g. a GraphQL server with queries ranging from milliseconds to several seconds). Unlike round-robin, `least_conn` routes each new request to whichever worker currently has the fewest active connections, avoiding the situation where a slow request blocks subsequent ones on the same worker.

To run:
```
# 1. Start the Bun workers via pm2 — must run from inside bun/forking/
cd bun/forking
pm2 start ecosystem.config.cjs

# 2. Load the nginx config (adjust path for your nginx setup)
nginx -c $(pwd)/nginx.conf
```
navigate to `http://localhost:5555` (nginx) — requests are distributed across workers on :5556, :5557, :5558.

pm2 still provides logging, auto-restart on crash, and memory/CPU monitoring for each worker process. nginx owns all load balancing decisions.

> **Note:** nginx's `proxy_next_upstream error timeout` directive is included but should be removed for non-idempotent operations (e.g. GraphQL mutations) to avoid a failed request being silently retried on another worker.

## Bun source code analysis

Inspecting Bun's source code reveals the precise cause of the failure.

### How Node's `node:cluster` round-robin is supposed to work

Node's round-robin mechanism works by intercepting `net.Server.listen()` calls in worker processes via `cluster._getServer()` ([src/js/internal/cluster/child.ts](bun-source/bun/src/js/internal/cluster/child.ts#L61)). When a worker calls `net.Server.listen()`, the cluster module:

1. Sends a `"queryServer"` IPC message to the primary
2. The primary creates a single `RoundRobinHandle` ([src/js/internal/cluster/RoundRobinHandle.ts](bun-source/bun/src/js/internal/cluster/RoundRobinHandle.ts)) that owns the real listening socket
3. The worker receives a **faux handle** — a plain JS object with no real socket behind it
4. Connections arrive at the primary's socket → `distribute()` → `handoff()` → sent to workers via IPC

Workers never bind a real socket. All connection distribution is explicit, round-robin, controlled by the primary.

### The bug: `Bun.serve()` bypasses `cluster._getServer()`

`Bun.serve()` is a native Zig API that creates a TCP socket directly, completely bypassing `net.Server`. Because it never calls `net.Server.listen()`, it never triggers `cluster._getServer()`. As a result:

- The primary never creates a `RoundRobinHandle`
- Workers never enter the round-robin system
- Each worker binds its own independent real socket on the port

### The `SO_REUSEPORT` auto-enable masks the problem

In [`src/bun.js/api/server/ServerConfig.zig:406`](bun-source/bun/src/bun.js/api/server/ServerConfig.zig#L406):

```zig
// If this is a node:cluster child, let's default to SO_REUSEPORT.
// That way you don't have to remember to set reusePort: true in Bun.serve() when using node:cluster.
.reuse_port = env.get("NODE_UNIQUE_ID") != null,
```

When a process is a cluster worker (detected by `NODE_UNIQUE_ID` being set), `Bun.serve()` automatically enables `SO_REUSEPORT`. This is a convenience workaround: since the round-robin mechanism never activates, at least let the OS distribute connections at the kernel level. But as demonstrated, this produces hash-based distribution on Linux (unreliable) and no distribution at all on macOS.

### The occasional correct distribution on Linux explained

The "sometimes works" behaviour seen with `cluster.ts` on Linux is not the cluster module working — it is purely the SO_REUSEPORT hash occasionally distributing 3 connections to 3 different workers by chance.

### IPC handle transfer is completely unimplemented in Bun

Even if `Bun.serve()` were fixed to call `cluster._getServer()`, the round-robin mechanism still could not work — because the IPC handle transfer in [`src/bun.js/node/node_cluster_binding.zig`](bun-source/bun/src/bun.js/node/node_cluster_binding.zig) is entirely unimplemented.

In Node.js, when the primary accepts a connection it passes the raw TCP socket (file descriptor) to the chosen worker via IPC using Unix `SCM_RIGHTS` fd passing. The worker then adopts that fd into its own event loop and handles the request. In Bun's IPC layer this mechanism does not exist:

**`sendHelperChild` throws if a handle is passed** ([node_cluster_binding.zig:30](bun-source/bun/src/bun.js/node/node_cluster_binding.zig#L30)):
```zig
if (!handle.isNull()) {
    return globalThis.throw("passing 'handle' not implemented yet", .{});
}
```

**`sendHelperPrimary` silently discards the handle** ([node_cluster_binding.zig:205](bun-source/bun/src/bun.js/node/node_cluster_binding.zig#L205)):
```zig
_ = handle;  // silently ignored
const success = ipc_data.serializeAndSend(globalThis, message, .internal, .null, null);
```

**All IPC callbacks always deliver `null` as the handle** ([node_cluster_binding.zig:136-139, 146-149](bun-source/bun/src/bun.js/node/node_cluster_binding.zig#L136)):
```zig
event_loop.runCallback(callback, globalThis, this.worker.get().?, &.{
    message,
    .null, // handle — always null, never a real socket fd
});
```

This means `RoundRobinHandle`'s `handoff()` call in [`RoundRobinHandle.ts`](bun-source/bun/src/js/internal/cluster/RoundRobinHandle.ts) — which is supposed to send a live TCP socket to the chosen worker — is effectively dead code. Even if the primary accepted a connection and selected a worker via round-robin, the socket would be dropped at the Zig IPC layer before reaching the worker. The `newconn` IPC message arrives at the worker's `onconnection()` handler in `child.ts` with a `null` handle, so no socket is ever adopted.

### What a proper fix requires

Fixing this correctly requires three layers of work:

1. **Native IPC fd transfer** in [`node_cluster_binding.zig`](bun-source/bun/src/bun.js/node/node_cluster_binding.zig): implement Unix `SCM_RIGHTS` fd passing so that a live TCP socket fd can be sent from the primary to a worker process over the IPC channel. The `"passing 'handle' not implemented yet"` error at line 30 must be replaced with real fd serialization.

2. **`Bun.serve()` cluster integration**: when `NODE_UNIQUE_ID` is set (i.e., the process is a cluster worker), `Bun.serve()` must call `cluster._getServer()` the same way `net.Server.listen()` does — sending a `queryServer` IPC message to the primary and receiving a faux handle in return. The relevant files:
   - [`src/js/internal/cluster/child.ts`](bun-source/bun/src/js/internal/cluster/child.ts) — `cluster._getServer()` hook needs to be reachable from `Bun.serve()`
   - [`src/bun.js/api/server/ServerConfig.zig`](bun-source/bun/src/bun.js/api/server/ServerConfig.zig) — `Bun.serve()` needs to call into the cluster module instead of defaulting to `SO_REUSEPORT`

3. **uWS socket adoption**: once a worker receives a live fd via IPC, it must adopt that fd into its uWebSockets event loop. The existing `SocketContext.adoptSocket()` API provides this capability, but it is not yet wired into the cluster path.

Once all three layers are in place, the `SO_REUSEPORT` auto-enable in `ServerConfig.zig` at line 406 could be removed, since workers would no longer need to bind their own sockets.