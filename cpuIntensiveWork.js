export function cpuIntensiveWork(duration = 1000) {
  const start = Date.now();
  let result = 0;

  while (Date.now() - start < duration) {
    for (let i = 0; i < 100000; i++) {
      result += Math.sqrt(i) * Math.sin(i) * Math.cos(i);
      result = result % 1000000;
    }
  }

  return result;
}