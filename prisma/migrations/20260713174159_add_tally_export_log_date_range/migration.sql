/*
  Warnings:

  - Added the required column `dateRangeFrom` to the `TallyExportLog` table without a default value. This is not possible if the table is not empty.
  - Added the required column `dateRangeTo` to the `TallyExportLog` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "TallyExportLog" ADD COLUMN     "dateRangeFrom" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "dateRangeTo" TIMESTAMP(3) NOT NULL;
