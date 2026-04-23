-- CreateTable
CREATE TABLE "calendar_external_syncs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "external_account_id" TEXT NOT NULL,
    "external_calendar_id" TEXT NOT NULL DEFAULT 'primary',
    "access_token_enc" TEXT NOT NULL,
    "refresh_token_enc" TEXT NOT NULL,
    "scope" TEXT,
    "token_expires_at" TIMESTAMP(3) NOT NULL,
    "sync_token" TEXT,
    "last_synced_at" TIMESTAMP(3),
    "last_sync_error" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_external_syncs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "calendar_external_syncs_user_id_key" ON "calendar_external_syncs"("user_id");

-- CreateIndex
CREATE INDEX "calendar_external_syncs_provider_idx" ON "calendar_external_syncs"("provider");

-- AddForeignKey
ALTER TABLE "calendar_external_syncs" ADD CONSTRAINT "calendar_external_syncs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "calendar_event_external_maps" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "external_event_id" TEXT NOT NULL,
    "external_calendar_id" TEXT NOT NULL,
    "last_synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendar_event_external_maps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "calendar_event_external_maps_provider_external_event_id_key" ON "calendar_event_external_maps"("provider", "external_event_id");

-- CreateIndex
CREATE INDEX "calendar_event_external_maps_event_id_provider_idx" ON "calendar_event_external_maps"("event_id", "provider");

-- AddForeignKey
ALTER TABLE "calendar_event_external_maps" ADD CONSTRAINT "calendar_event_external_maps_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "calendar_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
