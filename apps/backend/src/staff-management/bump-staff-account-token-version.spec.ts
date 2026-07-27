import { bumpStaffAccountTokenVersion } from './bump-staff-account-token-version';

// Focused unit coverage for the centralized StaffAccount.tokenVersion bump
// (see that function's file comment for why it takes a transaction client
// rather than a top-level PrismaService). Full behavioral coverage of WHEN
// this gets called lives in staff-management.service.spec.ts.
describe('bumpStaffAccountTokenVersion', () => {
  it('issues a tokenVersion increment update against the given transaction client and account id', async () => {
    const tx = { staffAccount: { update: jest.fn().mockResolvedValue({ id: 'account-1' }) } };

    await bumpStaffAccountTokenVersion(tx as never, 'account-1');

    expect(tx.staffAccount.update).toHaveBeenCalledWith({
      where: { id: 'account-1' },
      data: { tokenVersion: { increment: 1 } },
    });
  });

  it('composes cleanly inside a mocked $transaction callback, alongside another write on the same tx', async () => {
    const tx = {
      staffAccount: { update: jest.fn().mockResolvedValue({ id: 'account-1' }) },
      staff: { update: jest.fn().mockResolvedValue({ id: 's1' }) },
    };
    const fakeTransaction = (callback: (client: typeof tx) => unknown) => callback(tx);

    await fakeTransaction(async (client) => {
      await client.staffAccount.update({ where: { id: 'account-1' }, data: { name: 'New Name' } });
      await bumpStaffAccountTokenVersion(client as never, 'account-1');
      await client.staff.update({ where: { id: 's1' }, data: { active: false } });
    });

    expect(tx.staffAccount.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'account-1' },
      data: { name: 'New Name' },
    });
    expect(tx.staffAccount.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'account-1' },
      data: { tokenVersion: { increment: 1 } },
    });
    expect(tx.staff.update).toHaveBeenCalledWith({ where: { id: 's1' }, data: { active: false } });
  });
});
