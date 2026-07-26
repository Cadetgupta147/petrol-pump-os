-- AlterTable
ALTER TABLE "LubricantItem" DROP COLUMN "name",
ADD COLUMN     "costPrice" DOUBLE PRECISION,
ADD COLUMN     "itemId" TEXT NOT NULL,
ADD COLUMN     "salePrice" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "sku" TEXT;

-- CreateTable
CREATE TABLE "ItemSale" (
    "id" TEXT NOT NULL,
    "pumpId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "paymentType" "PaymentType" NOT NULL,
    "soldById" TEXT NOT NULL,
    "soldAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemSale_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LubricantItem_itemId_key" ON "LubricantItem"("itemId");

-- AddForeignKey
ALTER TABLE "LubricantItem" ADD CONSTRAINT "LubricantItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemSale" ADD CONSTRAINT "ItemSale_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemSale" ADD CONSTRAINT "ItemSale_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemSale" ADD CONSTRAINT "ItemSale_soldById_fkey" FOREIGN KEY ("soldById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

