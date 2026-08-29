/* delivery-socket.js
   Shared Socket.io connection.
   Listens for: "order:new", "order:taken", "delivery:approved"
   Requires socket.io-client script tag loaded before this file:
   <script src="/socket.io/socket.io.js"></script>
*/

const DeliverySocket = (() => {
  let socket = null;
  const listeners = {
    "order:new": [],
    "order:taken": [],
    "delivery:approved": [],
  };

  function connect() {
    if (socket || typeof io === "undefined") return socket;

    const token = window.DeliveryAuth ? window.DeliveryAuth.getToken() : null;
    if (!token) return null;

    socket = io({
      auth: { token },
      transports: ["websocket", "polling"],
    });

    socket.on("connect", () => console.log("[socket] connected"));
    socket.on("disconnect", () => console.log("[socket] disconnected"));
    socket.on("connect_error", (err) => console.warn("[socket] connect_error", err.message));

    Object.keys(listeners).forEach((event) => {
      socket.on(event, (payload) => {
        listeners[event].forEach((cb) => {
          try {
            cb(payload);
          } catch (e) {
            console.error(`[socket] listener error for ${event}`, e);
          }
        });
      });
    });

    return socket;
  }

  function on(event, callback) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(callback);
    connect();
  }

  function off(event, callback) {
    if (!listeners[event]) return;
    listeners[event] = listeners[event].filter((cb) => cb !== callback);
  }

  function disconnect() {
    if (socket) {
      socket.disconnect();
      socket = null;
    }
  }

  return { connect, on, off, disconnect };
})();

window.DeliverySocket = DeliverySocket;
