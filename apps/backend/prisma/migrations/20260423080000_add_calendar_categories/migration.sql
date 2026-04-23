-- CreateTable
CREATE TABLE "calendar_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "owner_id" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "calendar_categories_owner_id_idx" ON "calendar_categories"("owner_id");

-- AddForeignKey
ALTER TABLE "calendar_categories" ADD CONSTRAINT "calendar_categories_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "calendar_events" ADD COLUMN "category_id" TEXT;

-- CreateIndex
CREATE INDEX "calendar_events_category_id_idx" ON "calendar_events"("category_id");

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "calendar_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
