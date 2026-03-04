// bm2 ecosystem.config.ts
import type { EcosystemConfig } from "bm2/types";

const config: EcosystemConfig = {
  apps: [
    {
      name: "bunapp", 
      script: "index.ts", 
      execMode : "cluster",
      instances : 3,
      outFile: './bunapp-bm2.log',
      env: {
        name: "bunapp-bm2",
        port: "5557",
        manager: "bm2",
      }
    },
  ],
};

export default config;