import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { PinLoginDto } from './dto/pin-login.dto';
import { JwtPayload } from './types/jwt-payload.interface';

// Section 2 — web portal login (Owner/Accountant today; Manager/Read-only
// once those roles get real endpoints) via `login()`, plus Section 4's DSM
// app PIN login (Staff.pinHash) via `pinLogin()`.
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async login(dto: LoginDto) {
    const staff = await this.prisma.staff.findUnique({
      where: { phone: dto.phone },
    });

    // Same error for "no such staff", "inactive staff", and "wrong password"
    // — never reveal which part of the credential was wrong (standard
    // login-enumeration hygiene).
    if (!staff || !staff.active || !staff.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatches = await bcrypt.compare(dto.password, staff.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload: JwtPayload = {
      staffId: staff.id,
      role: staff.role,
      sub: staff.id,
    };

    return {
      accessToken: await this.jwtService.signAsync(payload),
      staff: {
        id: staff.id,
        name: staff.name,
        phone: staff.phone,
        role: staff.role,
      },
    };
  }

  // Section 4 — this is *the DSM app's* login method, but nothing here
  // restricts it to Role.DSM: any staff with a pinHash set (Owner/Accountant
  // included, if one is ever provisioned) can use it. Role-based screen
  // routing, if any, is a mobile-app concern, not this endpoint's job.
  async pinLogin(dto: PinLoginDto) {
    const staff = await this.prisma.staff.findUnique({
      where: { phone: dto.phone },
    });

    // Same error for "no such staff", "inactive staff", "no PIN set", and
    // "wrong PIN" — mirrors login()'s enumeration-safety reasoning above.
    if (!staff || !staff.active || !staff.pinHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const pinMatches = await bcrypt.compare(dto.pin, staff.pinHash);
    if (!pinMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload: JwtPayload = {
      staffId: staff.id,
      role: staff.role,
      sub: staff.id,
    };

    return {
      accessToken: await this.jwtService.signAsync(payload),
      staff: {
        id: staff.id,
        name: staff.name,
        phone: staff.phone,
        role: staff.role,
      },
    };
  }
}
