import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { BusinessProfileService } from './business-profile.service';
import { UpdateBusinessProfileDto } from './dto/update-business-profile.dto';

// Section 5B.2 — generous enough for a photographed/scanned logo or
// letterhead, small enough that a base64 copy sitting directly in a
// Postgres row (see business-profile.service.ts's comment on why) stays
// reasonable. Revisit once real object storage exists.
const MAX_BRANDING_IMAGE_BYTES = 2 * 1024 * 1024; // 2MB

// Section 3.9 — business profile / GSTIN / pump license settings.
// Section 5B — letterhead branding (logo/letterhead upload, OMC brand,
// phone) for the printable credit customer outstanding statement.
//
// Auth: GET is Owner/Accountant/Manager (view-only) — Manager is a
// deliberate addition here (method-level override below) beyond the
// class-level default, since printing the Section 5B credit statement
// (Manager-accessible, see CustomersController) needs to read the
// letterhead fields (logo/letterhead image, OMC brand, phone) from this same
// endpoint. Every mutation (PATCH + both uploads) stays Owner-only — per
// Section 2, Accountant explicitly "cannot change business settings", and
// branding/letterhead content is exactly that.
@Roles(Role.OWNER, Role.ACCOUNTANT)
@Controller('business-profile')
export class BusinessProfileController {
  constructor(private readonly businessProfileService: BusinessProfileService) {}

  @Roles(Role.OWNER, Role.ACCOUNTANT, Role.MANAGER)
  @Get()
  get() {
    return this.businessProfileService.getOrCreate();
  }

  @Roles(Role.OWNER)
  @Patch()
  update(@Body() dto: UpdateBusinessProfileDto) {
    return this.businessProfileService.update(dto);
  }

  // Memory storage only, exactly like purchases.controller.ts's OCR upload —
  // the buffer is converted to a base64 data URL and persisted by the
  // service, never written to disk here.
  @Roles(Role.OWNER)
  @Post('logo')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_BRANDING_IMAGE_BYTES },
    }),
  )
  uploadLogo(@UploadedFile() file?: Express.Multer.File) {
    assertValidImage(file);
    return this.businessProfileService.updateLogo(file.buffer, file.mimetype);
  }

  @Roles(Role.OWNER)
  @Post('letterhead')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_BRANDING_IMAGE_BYTES },
    }),
  )
  uploadLetterhead(@UploadedFile() file?: Express.Multer.File) {
    assertValidImage(file);
    return this.businessProfileService.updateLetterhead(file.buffer, file.mimetype);
  }
}

function assertValidImage(file?: Express.Multer.File): asserts file {
  if (!file) {
    throw new BadRequestException(
      'No file uploaded — attach an image under the "file" field',
    );
  }
  if (!file.mimetype?.startsWith('image/')) {
    throw new BadRequestException(
      `Unsupported file type "${file.mimetype}" — upload an image (JPEG/PNG/etc.)`,
    );
  }
}
