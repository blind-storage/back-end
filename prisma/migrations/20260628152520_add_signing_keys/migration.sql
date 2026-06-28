-- AlterTable
ALTER TABLE "User" ADD COLUMN     "key_certificate" JSONB,
ADD COLUMN     "key_certificate_signature" TEXT,
ADD COLUMN     "key_fingerprint" TEXT,
ADD COLUMN     "sign_priv_key_enc_1" TEXT,
ADD COLUMN     "sign_priv_key_enc_2" TEXT,
ADD COLUMN     "sign_pub_key" TEXT;
