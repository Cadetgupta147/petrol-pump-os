-- CreateTable
CREATE TABLE "CustomerOpeningBalance" (
    "id" TEXT NOT NULL,
    "pumpId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerOpeningBalance_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "CustomerOpeningBalance" ADD CONSTRAINT "CustomerOpeningBalance_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerOpeningBalance" ADD CONSTRAINT "CustomerOpeningBalance_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerOpeningBalance" ADD CONSTRAINT "CustomerOpeningBalance_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
