import { Prisma } from '@prisma/client';

// Customer-side mirror of staff-management/bump-staff-account-token-version.ts
// — see that file's comment for the full reasoning. Centralizes the
// CustomerAccount.tokenVersion "kill switch" increment (see that field's
// comment in prisma/schema.prisma and CustomerJwtStrategy.validate(), which
// rejects any JWT whose tokenVersion claim no longer matches the live DB
// value). Takes `tx` for the same atomicity reason as the staff version,
// even though today's only caller (logout) has nothing else to bundle it
// with — keeping the same shape means a future caller that DOES need to
// bundle it with another write doesn't have to touch this function.
export function bumpCustomerAccountTokenVersion(
  tx: Prisma.TransactionClient,
  accountId: string,
) {
  return tx.customerAccount.update({
    where: { id: accountId },
    data: { tokenVersion: { increment: 1 } },
  });
}
