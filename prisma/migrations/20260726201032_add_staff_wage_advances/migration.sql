-- AlterTable
ALTER TABLE "Staff" ADD COLUMN     "monthlySalary" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "StaffAdvance" (
    "id" TEXT NOT NULL,
    "pumpId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "givenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "repaidAt" TIMESTAMP(3),
    "recordedById" TEXT NOT NULL,

    CONSTRAINT "StaffAdvance_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "StaffAdvance" ADD CONSTRAINT "StaffAdvance_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAdvance" ADD CONSTRAINT "StaffAdvance_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAdvance" ADD CONSTRAINT "StaffAdvance_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
