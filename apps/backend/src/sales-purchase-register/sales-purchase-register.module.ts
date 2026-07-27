import { Module } from '@nestjs/common';
import { SalesPurchaseRegisterController } from './sales-purchase-register.controller';
import { SalesPurchaseRegisterService } from './sales-purchase-register.service';
import { TaxRateConfigModule } from '../tax-rate-config/tax-rate-config.module';

// Section 12 — GST-ready sales/purchase register. PrismaModule is global
// (see prisma.module.ts), so no imports needed beyond TaxRateConfigModule
// (Section 17.22 — dealer-configured per-product tax rate).
@Module({
  imports: [TaxRateConfigModule],
  controllers: [SalesPurchaseRegisterController],
  providers: [SalesPurchaseRegisterService],
})
export class SalesPurchaseRegisterModule {}
