-- CreateTable
CREATE TABLE "mail_domains" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "quota_bytes" BIGINT NOT NULL DEFAULT 107374182400,
    "max_aliases" INTEGER NOT NULL DEFAULT 400,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mail_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "workmail_user_id" TEXT,
    "imap_host" TEXT NOT NULL DEFAULT 'imap.mail.us-east-1.awsapps.com',
    "imap_port" INTEGER NOT NULL DEFAULT 993,
    "smtp_host" TEXT NOT NULL DEFAULT 'smtp.mail.us-east-1.awsapps.com',
    "smtp_port" INTEGER NOT NULL DEFAULT 465,
    "encrypted_password" TEXT NOT NULL,
    "quota_mb" INTEGER NOT NULL DEFAULT 51200,
    "used_mb" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_sync_at" TIMESTAMP(3),
    "last_sync_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mail_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mail_message_cache" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "uid" BIGINT NOT NULL,
    "folder" TEXT NOT NULL DEFAULT 'INBOX',
    "message_id" TEXT NOT NULL,
    "subject" TEXT,
    "from_email" TEXT NOT NULL,
    "from_name" TEXT,
    "to_json" JSONB NOT NULL,
    "cc_json" JSONB,
    "snippet" TEXT,
    "sent_at" TIMESTAMP(3) NOT NULL,
    "is_seen" BOOLEAN NOT NULL DEFAULT false,
    "is_flagged" BOOLEAN NOT NULL DEFAULT false,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "has_attachment" BOOLEAN NOT NULL DEFAULT false,
    "size" INTEGER NOT NULL,
    "cached_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_message_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mail_contacts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "frequency" INTEGER NOT NULL DEFAULT 1,
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mail_admin_logs" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "target_email" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_admin_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mail_domains_domain_key" ON "mail_domains"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "mail_accounts_user_id_key" ON "mail_accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "mail_accounts_email_key" ON "mail_accounts"("email");

-- CreateIndex
CREATE UNIQUE INDEX "mail_accounts_workmail_user_id_key" ON "mail_accounts"("workmail_user_id");

-- CreateIndex
CREATE INDEX "mail_message_cache_account_id_folder_sent_at_idx" ON "mail_message_cache"("account_id", "folder", "sent_at" DESC);

-- CreateIndex
CREATE INDEX "mail_message_cache_account_id_message_id_idx" ON "mail_message_cache"("account_id", "message_id");

-- CreateIndex
CREATE UNIQUE INDEX "mail_message_cache_account_id_folder_uid_key" ON "mail_message_cache"("account_id", "folder", "uid");

-- CreateIndex
CREATE INDEX "mail_contacts_user_id_frequency_idx" ON "mail_contacts"("user_id", "frequency" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "mail_contacts_user_id_email_key" ON "mail_contacts"("user_id", "email");

-- CreateIndex
CREATE INDEX "mail_admin_logs_target_email_created_at_idx" ON "mail_admin_logs"("target_email", "created_at");

-- CreateIndex
CREATE INDEX "mail_admin_logs_actor_id_created_at_idx" ON "mail_admin_logs"("actor_id", "created_at");

-- AddForeignKey
ALTER TABLE "mail_accounts" ADD CONSTRAINT "mail_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_message_cache" ADD CONSTRAINT "mail_message_cache_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "mail_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_contacts" ADD CONSTRAINT "mail_contacts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_admin_logs" ADD CONSTRAINT "mail_admin_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

