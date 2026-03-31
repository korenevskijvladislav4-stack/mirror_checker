import cron from "node-cron";
import { runDailyMirrorUpdate } from "../jobs/runDailyMirrorUpdate.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger();

export function startCron() {
  // node-cron использует IANA timezone.
  cron.schedule("0 0 * * *", async () => {
    logger.info("Daily mirror update started");
    try {
      const result = await runDailyMirrorUpdate({ dryRun: false });
      logger.info({ result }, "Daily mirror update finished");
    } catch (e) {
      logger.error({ err: e }, "Daily mirror update failed");
    }
  }, {
    timezone: "Europe/Moscow"
  });

  logger.info("Daily mirror cron scheduled for 00:00 Europe/Moscow");
}

