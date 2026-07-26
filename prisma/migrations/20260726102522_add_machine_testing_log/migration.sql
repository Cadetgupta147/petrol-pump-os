-- CreateTable
CREATE TABLE "MachineTestingLog" (
    "id" TEXT NOT NULL,
    "pumpId" TEXT NOT NULL,
    "tankId" TEXT NOT NULL,
    "litresDrawnOff" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "result" TEXT NOT NULL,
    "deviationFound" DOUBLE PRECISION,
    "calibrationChartRef" TEXT,
    "performedById" TEXT NOT NULL,
    "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "MachineTestingLog_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "MachineTestingLog" ADD CONSTRAINT "MachineTestingLog_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachineTestingLog" ADD CONSTRAINT "MachineTestingLog_tankId_fkey" FOREIGN KEY ("tankId") REFERENCES "Tank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachineTestingLog" ADD CONSTRAINT "MachineTestingLog_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
