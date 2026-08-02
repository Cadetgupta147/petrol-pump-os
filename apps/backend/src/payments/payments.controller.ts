import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/jwt-payload.interface';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto } from './dto/create-payment.dto';

// Section 3.4 — credit customer repayments, nested under the customer the
// same way opening-balance is (see CustomersController). Owner/Accountant
// only, matching the rest of credit-ledger management (Section 2's access
// matrix / CustomersController's class-level @Roles) — this is not a DSM or
// Manager counter action in the spec, unlike cash custody or bill entry.
@Roles(Role.OWNER, Role.ACCOUNTANT)
@Controller('customers/:customerId/payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  create(
    @Param('customerId') customerId: string,
    @Body() dto: CreatePaymentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.paymentsService.create(customerId, dto, user.staffId);
  }

  @Get()
  findAll(@Param('customerId') customerId: string) {
    return this.paymentsService.findAllForCustomer(customerId);
  }
}
