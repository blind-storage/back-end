CREATE TABLE "RevokedCertificate" (
    "id"          TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "reason"      TEXT NOT NULL,
    "revokedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RevokedCertificate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RevokedCertificate_fingerprint_key" ON "RevokedCertificate"("fingerprint");
