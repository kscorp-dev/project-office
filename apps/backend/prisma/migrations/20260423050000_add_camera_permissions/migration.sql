-- CreateEnum
CREATE TYPE "CameraPermissionSubjectType" AS ENUM ('user', 'department', 'role');

-- CreateEnum
CREATE TYPE "CameraPermissionLevel" AS ENUM ('view', 'control');

-- AlterTable
ALTER TABLE "cameras" ADD COLUMN     "ptz_adapter" TEXT,
ADD COLUMN     "ptz_username" TEXT,
ADD COLUMN     "ptz_password" TEXT,
ADD COLUMN     "is_public" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "camera_permissions" (
    "id" TEXT NOT NULL,
    "camera_id" TEXT NOT NULL,
    "subject_type" "CameraPermissionSubjectType" NOT NULL,
    "subject_id" TEXT NOT NULL,
    "level" "CameraPermissionLevel" NOT NULL DEFAULT 'view',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "camera_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "camera_permissions_camera_id_subject_type_subject_id_key" ON "camera_permissions"("camera_id", "subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "camera_permissions_subject_type_subject_id_idx" ON "camera_permissions"("subject_type", "subject_id");

-- AddForeignKey
ALTER TABLE "camera_permissions" ADD CONSTRAINT "camera_permissions_camera_id_fkey" FOREIGN KEY ("camera_id") REFERENCES "cameras"("id") ON DELETE CASCADE ON UPDATE CASCADE;
