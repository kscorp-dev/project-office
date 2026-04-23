/**
 * 연차 자동 부여 스케줄러
 *
 * 실행 일정:
 *   - 매년 1월 1일 01:00 KST — 전체 active 직원 연간 연차 부여
 *   - 매월 1일 01:30 KST — 근속 1년 미만 직원 월차 +1
 *
 * 모두 멱등성 있음:
 *   - 같은 (user, year)에 이미 grantedAt 이 있으면 skip
 *   - 월차는 max 11일까지만 누적
 *
 * 비활성:
 *   DISABLE_VACATION_ACCRUAL_CRON=true 환경변수로 끌 수 있음 (테스트/단일 인스턴스 외 환경)
 */
import cron from 'node-cron';
import { logger } from '../config/logger';
import { runAnnualAccrualBatch, runMonthlyAccrualBatch } from '../services/vacation-accrual.service';

let annualTask: cron.ScheduledTask | null = null;
let monthlyTask: cron.ScheduledTask | null = null;

export function startVacationAccrualScheduler(): void {
  if (process.env.DISABLE_VACATION_ACCRUAL_CRON === 'true') {
    logger.info('[vacation-accrual] DISABLED by env flag');
    return;
  }

  // 매년 1월 1일 01:00 KST
  // cron 기본 타임존은 UTC — 한국(KST=UTC+9)의 01:00 = UTC 전일 16:00
  // node-cron은 timezone 옵션으로 KST 지정 가능
  annualTask = cron.schedule(
    '0 1 1 1 *',
    async () => {
      const year = new Date().getFullYear();
      logger.info({ year }, '[vacation-accrual] annual batch start');
      try {
        const result = await runAnnualAccrualBatch(year);
        logger.info(result, '[vacation-accrual] annual batch done');
      } catch (e) {
        logger.error({ err: e }, '[vacation-accrual] annual batch failed');
      }
    },
    { timezone: 'Asia/Seoul' },
  );

  // 매월 1일 01:30 KST
  monthlyTask = cron.schedule(
    '30 1 1 * *',
    async () => {
      logger.info('[vacation-accrual] monthly batch start');
      try {
        const result = await runMonthlyAccrualBatch(new Date());
        logger.info(result, '[vacation-accrual] monthly batch done');
      } catch (e) {
        logger.error({ err: e }, '[vacation-accrual] monthly batch failed');
      }
    },
    { timezone: 'Asia/Seoul' },
  );

  logger.info('[vacation-accrual] scheduler started (annual: Jan 1 01:00 KST, monthly: 1st 01:30 KST)');
}

export function stopVacationAccrualScheduler(): void {
  annualTask?.stop();
  monthlyTask?.stop();
  annualTask = null;
  monthlyTask = null;
  logger.info('[vacation-accrual] scheduler stopped');
}
