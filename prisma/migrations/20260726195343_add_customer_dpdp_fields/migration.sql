-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "dataConsentAt" TIMESTAMP(3),
ADD COLUMN     "dataConsentVersion" TEXT,
ADD COLUMN     "dataDeletedAt" TIMESTAMP(3);
