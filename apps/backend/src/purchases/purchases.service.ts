import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePurchaseEntryDto } from './dto/create-purchase-entry.dto';

// Section 7.1/7.2 — manual purchase entry. Tanker delivery -> Purchase
// Entry created -> tank level increases, all in one transaction.
// Section 9 — OCR only feeds this DTO's fields as pre-fill via a separate
// endpoint (see ocr/ocr.service.ts and the ocr-extract route on
// PurchasesController); this create() flow itself is unchanged by that.
// ocrExtracted is pure provenance metadata: persisted as whatever the
// client sends (default false), not derived or trust-gated server-side.
//
// Auth: enforced at the controller level (global JwtAuthGuard + RolesGuard,
// see purchases.controller.ts) — Owner/Accountant only. This is a
// procurement/accounting action, not a DSM task — DSM never touches this
// module.
//
// ASYMMETRY vs MeterReadingsService.closeShift()'s tank auto-deduction
// (documented there too, read both comments together): a purchase entry is a
// deliberate accounting action taken by Owner/Accountant when a tanker
// delivers fuel — nothing forces it to happen except someone recording it.
// If no Tank exists for the stated productType, we HARD-BLOCK the create
// (404) rather than silently accepting an unrecorded delivery against
// inventory: a real fuel delivery going untracked would defeat the entire
// point of this module (Section 7.2's variance report), and letting it slide
// silently is a worse outcome than making the Owner/Accountant go create the
// Tank first. Contrast with closeShift(), where NOT blocking is correct: a
// DSM must always be able to close their shift and go home regardless of
// whether back-office inventory setup is complete — that's an operational
// necessity, not a discretionary accounting entry.
@Injectable()
export class PurchasesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreatePurchaseEntryDto) {
    // Match Tank by exact productType string equality — same loose
    // string-typed-product convention Bill/RateHistory already use (no typed
    // Product enum exists in this schema to join against instead).
    const tank = await this.prisma.tank.findFirst({
      where: { productType: dto.productType },
    });
    if (!tank) {
      throw new NotFoundException(
        `No tank configured for product ${dto.productType} — create one first via POST /tanks`,
      );
    }

    const [purchaseEntry] = await this.prisma.$transaction([
      this.prisma.purchaseEntry.create({
        data: {
          supplierName: dto.supplierName,
          productType: dto.productType,
          quantityLitres: dto.quantityLitres,
          amount: dto.amount,
          ratePerLitre: dto.ratePerLitre,
          invoiceNo: dto.invoiceNo,
          tankerNo: dto.tankerNo,
          invoiceImageUrl: dto.invoiceImageUrl,
          ocrExtracted: dto.ocrExtracted ?? false,
        },
      }),
      this.prisma.tank.update({
        where: { id: tank.id },
        data: { currentStockLitres: { increment: dto.quantityLitres } },
      }),
    ]);

    return purchaseEntry;
  }

  findAll() {
    return this.prisma.purchaseEntry.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const entry = await this.prisma.purchaseEntry.findUnique({
      where: { id },
    });
    if (!entry) {
      throw new NotFoundException(`PurchaseEntry ${id} not found`);
    }
    return entry;
  }
}
