import { Prisma } from '@prisma/client';

// Centralizes the StaffAccount.tokenVersion "kill switch" increment (see
// that field's comment in prisma/schema.prisma and JwtStrategy.validate(),
// which rejects any JWT whose tokenVersion claim no longer matches the live
// DB value). StaffManagementService.update() is the only caller today, but
// this is pulled out into its own helper rather than an inline
// `{ tokenVersion: { increment: 1 } }` literal so a future call site that
// also needs to revoke sessions (e.g. a manual-unlock/force-logout action)
// composes the same way instead of re-deriving the Prisma shape itself.
//
// Deliberately takes `tx` — the transaction client handed to the callback
// passed to `$transaction(async (tx) => ...)` — rather than reaching for
// `this.prisma`/a fresh top-level PrismaService instance. Every real call
// site bumps tokenVersion BECAUSE something else about the account/
// membership changed in the same request (deactivation, a credential reset,
// a role change); that other write and this bump must commit or roll back
// together as one atomic unit. A version of this helper that always used a
// standalone `prisma.staffAccount.update(...)` outside whatever transaction
// the caller is already in would break that guarantee — e.g. the account
// write could commit while a related membership write in the same
// operation fails, leaving tokenVersion bumped for a change that never
// actually happened, or vice versa.
export function bumpStaffAccountTokenVersion(tx: Prisma.TransactionClient, accountId: string) {
  return tx.staffAccount.update({
    where: { id: accountId },
    data: { tokenVersion: { increment: 1 } },
  });
}
