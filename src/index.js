import { createApp } from "./app.js";
import { startCron } from "./scheduler/dailyCron.js";

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

const app = createApp();
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on :${PORT}`);
});

startCron();

