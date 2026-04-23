-- CreateTable
CREATE TABLE "calendar_subscriptions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'personal',
    "include_vacation" BOOLEAN NOT NULL DEFAULT true,
    "include_meeting" BOOLEAN NOT NULL DEFAULT true,
    "include_tasks" BOOLEAN NOT NULL DEFAULT false,
    "reminder_minutes" INTEGER[] DEFAULT ARRAY[10]::INTEGER[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_accessed_at" TIMESTAMP(3),
    "access_count" INTEGER NOT NULL DEFAULT 0,
    "last_etag" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "calendar_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "calendar_subscriptions_token_key" ON "calendar_subscriptions"("token");

-- CreateIndex
CREATE INDEX "calendar_subscriptions_user_id_is_active_idx" ON "calendar_subscriptions"("user_id", "is_active");

-- CreateIndex
CREATE INDEX "calendar_subscriptions_token_idx" ON "calendar_subscriptions"("token");

-- AddForeignKey
ALTER TABLE "calendar_subscriptions" ADD CONSTRAINT "calendar_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
