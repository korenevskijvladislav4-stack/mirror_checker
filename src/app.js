import express from "express";
import { healthRouter } from "./routes/health.js";
import { runOnceRouter } from "./routes/runOnce.js";

export function createApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.use("/health", healthRouter);
  app.use("/", runOnceRouter);

  return app;
}

