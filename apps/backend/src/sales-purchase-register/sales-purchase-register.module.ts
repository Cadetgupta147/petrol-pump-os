import { Module } from '@nestjs/common';
import { SalesPurchaseRegisterController } from './sales-purchase-register.controller';
import { SalesPurchaseRegisterService } from './sales-purchase-register.service';

// Section 12 — GST-ready sales/purchase register. PrismaModule is global
// (see prisma.module.ts), so no imports needed.
@Module({
  controllers: [SalesPurchaseRegisterController],
  providers: [SalesPurchaseRegisterService],
})
export class SalesPurchaseRegisterModule {}
