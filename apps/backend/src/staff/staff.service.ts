import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Minimal staff-directory read model. This exists ONLY to populate a
// "pick a person" dropdown elsewhere in the app (currently: Cash Custody's
// handled-by field) — NOT a Section 3.7 Staff Management screen, which
// doesn't exist yet. Deliberately returns id + name only: no pinHash,
// passwordHash, phone, or role, since none of that belongs in a picker list.
@Injectable()
export class StaffService {
  constructor(private readonly prisma: PrismaService) {}

  // Only active staff — a deactivated staff member shouldn't be selectable
  // for "who is handling cash today" (or any other new day-forward entry)
  // without a specific reason to include them.
  findAll() {
    return this.prisma.staff.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }
}
