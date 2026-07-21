import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateBusinessProfileDto } from './dto/update-business-profile.dto';

// Section 3.9 — business profile, GSTIN, pump license details.
//
// Singleton pattern, same as CreditConfigService: pinned to a fixed, known
// id, every read/write goes through upsert() against that id, which is
// atomic at the DB level (id has a unique constraint via @id).
//
// Auth/role guards do exist and apply here: the global JwtAuthGuard
// (app.module.ts) requires a valid JWT on every route, and
// BusinessProfileController carries @Roles(Role.OWNER) on the mutation
// route (PATCH) — see that controller's comment for why.
const BUSINESS_PROFILE_ID = 'singleton';

@Injectable()
export class BusinessProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrCreate() {
    return this.prisma.businessProfile.upsert({
      where: { id: BUSINESS_PROFILE_ID },
      create: { id: BUSINESS_PROFILE_ID },
      update: {},
    });
  }

  async update(dto: UpdateBusinessProfileDto) {
    return this.prisma.businessProfile.upsert({
      where: { id: BUSINESS_PROFILE_ID },
      create: {
        id: BUSINESS_PROFILE_ID,
        ...(dto.businessName !== undefined && { businessName: dto.businessName }),
        ...(dto.gstin !== undefined && { gstin: dto.gstin }),
        ...(dto.pumpLicenseNo !== undefined && { pumpLicenseNo: dto.pumpLicenseNo }),
        ...(dto.address !== undefined && { address: dto.address }),
      },
      update: {
        ...(dto.businessName !== undefined && { businessName: dto.businessName }),
        ...(dto.gstin !== undefined && { gstin: dto.gstin }),
        ...(dto.pumpLicenseNo !== undefined && { pumpLicenseNo: dto.pumpLicenseNo }),
        ...(dto.address !== undefined && { address: dto.address }),
      },
    });
  }
}
