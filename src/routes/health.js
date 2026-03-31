import { Router } from "express";
import { z } from "zod";

const Env = z.object({
  PORT: z.string().optional(),
}).passthrough();

export const healthRouter = Router();

healthRouter.get("/", (req, res) => {
  const parsed = Env.safeParse(process.env);
  res.json({
    ok: true,
    env: parsed.success ? "loaded" : "unverified",
    timestamp: new Date().toISOString(),
  });
});

