import cron from "node-cron";
import { runDailyMirrorUpdate } from "../jobs/runDailyMirrorUpdate.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger();

export function startCron() {
  // node-cron использует IANA timezone.
  cron.schedule("0 * * * *", async () => {
    logger.info("Hourly mirror update started");
    try {
      const result = await runDailyMirrorUpdate({ dryRun: false });
      logger.info({ result }, "Hourly mirror update finished");
    } catch (e) {
      logger.error({ err: e }, "Hourly mirror update failed");
    }
  }, {
    timezone: "Europe/Moscow"
  });

  logger.info("Hourly mirror cron scheduled for :00 Europe/Moscow");
}

