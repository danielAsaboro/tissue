import { analystPort, createAnalystServer } from "./server.js";

const port = analystPort();
createAnalystServer().listen(port, () => {
  console.error(`[analyst] read-only analyst service on :${port} (POST /chat)`);
});
