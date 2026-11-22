const mode = new URL(import.meta.url).searchParams.get("vfs");
const ownerMode = mode === "opfs-sahpool";
const workerUrl = new URL("./worker.mjs", import.meta.url);
workerUrl.searchParams.set("vfs", mode);

const tab = crypto.randomUUID();
let sequence = 0;

function connection() {
  const worker = new Worker(workerUrl, { type: "module" });
  const waiting = new Map();
  worker.onmessage = ({ data }) => waiting.get(data.id)?.resolve(data);
  worker.onerror = (event) => {
    const error = new Error(event.message || "SQLite worker failed");
    for (const pending of waiting.values()) pending.reject(error);
  };
  return {
    async send(command, args) {
      const id = tab + ":" + sequence++;
      try {
        return await new Promise((resolve, reject) => {
          waiting.set(id, { resolve, reject });
          worker.postMessage({ id, command, args });
        });
      } finally {
        waiting.delete(id);
      }
    },
    stop: () => worker.terminate(),
  };
}

function direct() {
  const local = connection();
  window.proofOwner = true;
  return local.send;
}

// A waiting tab never opens the VFS. Each retry keeps the original request and operation IDs.
function electOwner() {
  if (!navigator.locks) throw new Error("Web Locks unavailable");
  const channel = new BroadcastChannel("feito-sqlite-proof");
  const release = new AbortController();
  const waiting = new Map();
  const inFlight = new Set();
  let owner;
  window.proofOwner = false;

  async function receive(message) {
    if (message.type === "response") {
      waiting.get(message.id)?.(message.reply);
    } else if (message.type === "request" && owner && !inFlight.has(message.id)) {
      inFlight.add(message.id);
      try {
        const reply = await owner.send(message.command, message.args);
        const answer = { type: "response", id: message.id, reply };
        channel.postMessage(answer);
        void receive(answer);
      } catch (error) {
        const answer = { type: "response", id: message.id, reply: { error: error.message } };
        channel.postMessage(answer);
        void receive(answer);
      } finally {
        inFlight.delete(message.id);
      }
    }
  }

  channel.onmessage = ({ data }) => { void receive(data); };
  addEventListener("pagehide", () => release.abort(), { once: true });
  // Terminate the worker before the callback returns and releases the lock.
  void navigator.locks.request("feito-sqlite-proof", { signal: release.signal }, async () => {
    owner = connection();
    window.proofOwner = true;
    await new Promise((resolve) => release.signal.addEventListener("abort", resolve, { once: true }));
    window.proofOwner = false;
    owner.stop();
    owner = undefined;
    channel.close();
  }).catch((error) => {
    if (error.name !== "AbortError") console.error(error);
  });

  return async (command, args) => {
    const id = tab + ":" + sequence++;
    const request = { type: "request", id, command, args };
    const send = () => {
      channel.postMessage(request);
      void receive(request);
    };
    let interval;
    let timer;
    try {
      return await new Promise((resolve, reject) => {
        waiting.set(id, resolve);
        timer = setTimeout(() => reject(new Error("No SQLite owner responded")), 10_000);
        interval = setInterval(send, 250);
        send();
      });
    } finally {
      waiting.delete(id);
      clearInterval(interval);
      clearTimeout(timer);
    }
  };
}

const send = ownerMode ? electOwner() : direct();
window.run = async (command, args) => {
  let timer;
  try {
    const reply = await Promise.race([
      send(command, args),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("SQLite request timed out")), 15_000); }),
    ]);
    if (reply.error) throw new Error(reply.error);
    return reply;
  } finally {
    clearTimeout(timer);
  }
};
