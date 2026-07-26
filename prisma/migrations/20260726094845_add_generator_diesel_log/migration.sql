-- CreateTable
CREATE TABLE "GeneratorDieselLog" (
    "id" TEXT NOT NULL,
    "pumpId" TEXT NOT NULL,
    "tankId" TEXT NOT NULL,
    "quantityLitres" DOUBLE PRECISION NOT NULL,
    "recordedById" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "GeneratorDieselLog_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "GeneratorDieselLog" ADD CONSTRAINT "GeneratorDieselLog_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratorDieselLog" ADD CONSTRAINT "GeneratorDieselLog_tankId_fkey" FOREIGN KEY ("tankId") REFERENCES "Tank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratorDieselLog" ADD CONSTRAINT "GeneratorDieselLog_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
