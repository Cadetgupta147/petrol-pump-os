import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './types/jwt-payload.interface';

// Section 2 — web portal login (Owner/Accountant today; Manager/Read-only
// once those roles get real endpoints). DSM app PIN login (Staff.pinHash) is
// a separate, unrelated flow and out of scope here.
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
}
