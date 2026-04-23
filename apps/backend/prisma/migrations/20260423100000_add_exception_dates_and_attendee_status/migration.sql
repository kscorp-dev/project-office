-- AlterTable
ALTER TABLE "calendar_events" ADD COLUMN "exception_dates" TEXT[] DEFAULT ARRAY[]::TEXT[];
