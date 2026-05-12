/*
  Warnings:

  - A unique constraint covering the columns `[tree_enc_key]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `tree_enc_key` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "OidcProvider" AS ENUM ('GOOGLE', 'REZEL');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "role" "Role" NOT NULL DEFAULT 'USER',
ADD COLUMN     "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "totpSecret" TEXT,
ADD COLUMN     "tree_enc_key" TEXT NOT NULL,
ALTER COLUMN "auth_hash" DROP NOT NULL,
ALTER COLUMN "salt_mp" DROP NOT NULL,
ALTER COLUMN "salt_rc" DROP NOT NULL;

-- CreateTable
CREATE TABLE "TotpRecoveryCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TotpRecoveryCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OidcConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "OidcProvider" NOT NULL,
    "providerUserId" TEXT NOT NULL,
    "email" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "driveScope" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OidcConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OidcConnection_userId_idx" ON "OidcConnection"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OidcConnection_provider_providerUserId_key" ON "OidcConnection"("provider", "providerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "OidcConnection_userId_provider_key" ON "OidcConnection"("userId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "User_tree_enc_key_key" ON "User"("tree_enc_key");

-- AddForeignKey
ALTER TABLE "TotpRecoveryCode" ADD CONSTRAINT "TotpRecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OidcConnection" ADD CONSTRAINT "OidcConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
