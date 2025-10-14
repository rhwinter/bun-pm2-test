# bun-pm2

Run without pm2:
```
cd bun
bun index.ts
```
navigate to `http://localhost:5555`

```
cd node+npm
node index.js
```
navigate to `http://localhost:5556`

Then run the Bun with pm2
```
cd bun
npm -g uninstall pm2
bun -g install pm2-beta
pm2 update
pm2 start ecosystem.config.js
```
navigate to `http://localhost:5555`

Compare the results with the node+npm version
```
pm2 delete all
bun -g uninstall pm2-beta
npm -g install pm2
pm2 update
cd node+npm
pm2 start ecosystem.config.cjs
```