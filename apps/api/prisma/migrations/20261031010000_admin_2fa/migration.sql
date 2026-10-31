-- AlterTable
ALTER TABLE "User" ADD COLUMN     "totpEnabledAt" TIMESTAMP(3),
ADD COLUMN     "totpRecoveryHashes" TEXT[],
ADD COLUMN     "totpSecretEnc" TEXT;

