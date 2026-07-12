-- CreateEnum
CREATE TYPE "CustomerVerificationStatus" AS ENUM ('INFORMAL', 'VERIFIED');

-- CreateEnum
CREATE TYPE "CreditEnforcementMode" AS ENUM ('NOTIFY', 'BLOCK');

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "verificationStatus" "CustomerVerificationStatus" NOT NULL DEFAULT 'VERIFIED',
ALTER COLUMN "phone" DROP NOT NULL;

-- CreateTable
CREATE TABLE "CreditConfig" (
    "id" TEXT NOT NULL,
    "enforcementMode" "CreditEnforcementMode" NOT NULL DEFAULT 'NOTIFY',
    "defaultInformalCreditLimit" DOUBLE PRECISION NOT NULL DEFAULT 5000,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditLimitAlert" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "outstandingBefore" DOUBLE PRECISION NOT NULL,
    "billNetCredit" DOUBLE PRECISION NOT NULL,
    "creditLimit" DOUBLE PRECISION NOT NULL,
    "overageAmount" DOUBLE PRECISION NOT NULL,
    "reminderRequested" BOOLEAN,
    "reminderRequestedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditLimitAlert_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "CreditLimitAlert" ADD CONSTRAINT "CreditLimitAlert_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditLimitAlert" ADD CONSTRAINT "CreditLimitAlert_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
