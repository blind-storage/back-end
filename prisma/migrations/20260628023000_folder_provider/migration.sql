ALTER TABLE "Folder" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'google-drive';

CREATE INDEX "Folder_ownerId_provider_idx" ON "Folder"("ownerId", "provider");
