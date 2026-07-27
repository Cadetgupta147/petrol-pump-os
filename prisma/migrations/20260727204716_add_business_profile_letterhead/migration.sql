-- CreateEnum
CREATE TYPE "OmcBrand" AS ENUM ('IOCL', 'BPCL', 'HPCL', 'OTHER', 'NONE');

-- AlterTable
ALTER TABLE "BusinessProfile" ADD COLUMN     "letterheadImageData" TEXT,
ADD COLUMN     "logoImageData" TEXT,
ADD COLUMN     "omcBrand" "OmcBrand" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "useUploadedLetterhead" BOOLEAN NOT NULL DEFAULT false;
