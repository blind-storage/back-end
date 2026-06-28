ALTER TABLE "User"
ADD COLUMN "sign_pub_key" TEXT,
ADD COLUMN "sign_priv_key_enc_1" TEXT,
ADD COLUMN "sign_priv_key_enc_2" TEXT,
ADD COLUMN "key_certificate" JSONB,
ADD COLUMN "key_certificate_signature" TEXT,
ADD COLUMN "key_fingerprint" TEXT;

CREATE UNIQUE INDEX "User_sign_pub_key_key" ON "User"("sign_pub_key");
CREATE UNIQUE INDEX "User_sign_priv_key_enc_1_key" ON "User"("sign_priv_key_enc_1");
CREATE UNIQUE INDEX "User_sign_priv_key_enc_2_key" ON "User"("sign_priv_key_enc_2");
CREATE UNIQUE INDEX "User_key_fingerprint_key" ON "User"("key_fingerprint");
