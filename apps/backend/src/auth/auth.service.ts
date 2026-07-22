import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { PinLoginDto } from './dto/pin-login.dto';
import { JwtPayload } from './types/jwt-payload.interface';

// Section 2 — web portal login (Owner/Accountant today; Manager/Read-only
// once those roles get real endpoints) via `login()`, plus Section 4's DSM
// app PIN login (StaffAccount.pinHash) via `pinLogin()`.
//
// Phase 0.2 (docs/multi-tenancy-plan.md): the credential lives on
// StaffAccount (the login identity); the resolved Staff row is the per-pump
// MEMBERSHIP that everything downstream (Bill.enteredById, etc.) actually
// points at. v1 takes the account's first active membership — a person with
// memberships at more than one pump needs a picker UI that doesn't exist
// yet (see the plan doc's "not in scope" list).
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async login(dto: LoginDto) {
    const account = await this.prisma.staffAccount.findUnique({
      where: { phone: dto.phone },
    });

    // Same error for "no such account", "inactive account", and "wrong
    // password" — never reveal which part of the credential was wrong
    // (standard login-enumeration hygiene).
    if (!account || !account.active || !account.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatches = await bcrypt.compare(dto.password, account.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const membership = await this.prisma.staff.findFirst({
      where: { accountId: account.id, active: true },
    });
    if (!membership || !membership.pumpId) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload: JwtPayload = {
      staffId: membership.id,
      pumpId: membership.pumpId,
      role: membership.role,
      sub: membership.id,
    };

    return {
      accessToken: await this.jwtService.signAsync(payload),
      staff: {
        id: membership.id,
        name: membership.name,
        phone: account.phone,
        role: membership.role,
      },
    };
  }

  // Section 4 — this is *the DSM app's* login method, but nothing here
  // restricts it to Role.DSM: any account with a pinHash set (Owner/
  // Accountant included, if one is ever provisioned) can use it. Role-based
  // screen routing, if any, is a mobile-app concern, not this endpoint's job.
  async pinLogin(dto: PinLoginDto) {
    const account = await this.prisma.staffAccount.findUnique({
      where: { phone: dto.phone },
    });

    // Same error for "no such account", "inactive account", "no PIN set",
    // and "wrong PIN" — mirrors login()'s enumeration-safety reasoning above.
    if (!account || !account.active || !account.pinHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const pinMatches = await bcrypt.compare(dto.pin, account.pinHash);
    if (!pinMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const membership = await this.prisma.staff.findFirst({
      where: { accountId: account.id, active: true },
    });
    if (!membership || !membership.pumpId) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload: JwtPayload = {
      staffId: membership.id,
      pumpId: membership.pumpId,
      role: membership.role,
      sub: membership.id,
    };

    return {
      accessToken: await this.jwtService.signAsync(payload),
      staff: {
        id: membership.id,
        name: membership.name,
        phone: account.phone,
        role: membership.role,
      },
    };
  }
}
