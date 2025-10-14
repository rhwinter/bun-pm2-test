# bun-pm2

## Run without pm2

The **bun** version:
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

## Run *with* pm2

The **bun** version:
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