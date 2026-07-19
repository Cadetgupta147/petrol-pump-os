/*
  Warnings:

  - Added the required column `updatedAt` to the `LoyaltyConfig` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "LoyaltyConfig" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "redemptionTypeAllowed" DROP NOT NULL,
ALTER COLUMN "cashRedemptionRatio" DROP NOT NULL,
ALTER COLUMN "minRedeemablePoints" DROP NOT NULL;
