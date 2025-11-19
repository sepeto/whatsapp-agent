const { AsyncQueue } = require("./queue.js");

const queuesByKey = new Map();

function getQueueForKey(key) {
  let q = queuesByKey.get(key);
  if (!q) {
    q = new AsyncQueue();
    queuesByKey.set(key, q);
  }
  return q;
}

// Limpieza opcional: si querés liberar memoria cuando no quede trabajo
function cleanupQueue(key) {
  const q = queuesByKey.get(key);
  if (q && q.queue.length === 0 && !q.running) {
    queuesByKey.delete(key);
  }
}

module.exports = { getQueueForKey, cleanupQueue };