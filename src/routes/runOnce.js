import { Router } from "express";
import { runDailyMirrorUpdate } from "../jobs/runDailyMirrorUpdate.js";

export const runOnceRouter = Router();

runOnceRouter.post("/run-once", async (req, res) => {
  const dryRun = Boolean(req.body?.dryRun);
  try {
    const result = await runDailyMirrorUpdate({ dryRun });
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

