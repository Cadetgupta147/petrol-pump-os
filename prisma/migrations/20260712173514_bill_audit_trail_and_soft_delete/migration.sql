-- CreateEnum
CREATE TYPE "BillAuditAction" AS ENUM ('CREATED', 'EDITED', 'DELETED');

-- AlterTable
ALTER TABLE "Bill" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedById" TEXT,
ADD COLUMN     "lastEditedAt" TIMESTAMP(3),
ADD COLUMN     "lastEditedById" TEXT;

-- CreateTable
CREATE TABLE "BillAuditLog" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "action" "BillAuditAction" NOT NULL,
    "performedById" TEXT NOT NULL,
    "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snapshot" JSONB NOT NULL,

    CONSTRAINT "BillAuditLog_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_lastEditedById_fkey" FOREIGN KEY ("lastEditedById") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillAuditLog" ADD CONSTRAINT "BillAuditLog_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillAuditLog" ADD CONSTRAINT "BillAuditLog_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
