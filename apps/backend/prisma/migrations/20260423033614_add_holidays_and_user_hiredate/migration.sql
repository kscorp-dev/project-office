/*
  Warnings:

  - Added the required column `updated_at` to the `vacation_balances` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "HolidayType" AS ENUM ('legal', 'substitute', 'company', 'event');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "hire_date" DATE;

-- AlterTable
ALTER TABLE "vacation_balances" ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "granted_at" TIMESTAMP(3),
ADD COLUMN     "tenure_years" DOUBLE PRECISION,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
-- Prisma updatedAt은 application-level이므로 DEFAULT는 초기 백필용으로만 필요
-- 새 row는 @updatedAt이 알아서 설정

-- CreateTable
CREATE TABLE "holidays" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "type" "HolidayType" NOT NULL DEFAULT 'legal',
    "exclude_from_workdays" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "holidays_date_idx" ON "holidays"("date");

-- CreateIndex
CREATE INDEX "holidays_type_idx" ON "holidays"("type");

-- CreateIndex
CREATE UNIQUE INDEX "holidays_date_name_key" ON "holidays"("date", "name");
