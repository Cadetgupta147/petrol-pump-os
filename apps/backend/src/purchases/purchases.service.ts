import { randomUUID } from 'crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PurchaseEntry } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePurchaseEntryDto } from './dto/create-purchase-entry.dto';
import { computeDensityFlag } from '../density-logs/density-logs.service';

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

  // Finding A1 (docs/production-readiness.md) — recordedById is not a DTO
  // field; PurchasesController derives it from req.user.staffId and passes
  // it as its own argument, used only when a densityValue rides along with
  // this delivery.
  async create(dto: CreatePurchaseEntryDto, recordedById: string) {
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

    const purchaseEntryId = randomUUID();

    // Section 7.3 — when a density/quality reading rides along with this
    // delivery, it's linked (purchaseEntryId) and created atomically with the
    // PurchaseEntry + Tank stock increment below. This transaction stays in
    // its existing ARRAY form (not rewritten into the callback form) to match
    // the rest of this method — Prisma resolves array-form entries inside one
    // transaction the same as the callback form, so atomicity is preserved.
    // Because the array form can't read back purchaseEntry.id mid-transaction
    // (each promise is built up front, not sequenced against prior results),
    // the id is pre-generated with the same @default(cuid())-compatible
    // generator Prisma itself would otherwise assign, and passed explicitly
    // to both creates.
    const operations: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.purchaseEntry.create({
        data: {
          id: purchaseEntryId,
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
    ];

    if (dto.densityValue !== undefined) {
      operations.push(
        this.prisma.densityLog.create({
          data: {
            tankId: tank.id,
            densityValue: dto.densityValue,
            ppmValue: dto.ppmValue,
            recordedById,
            purchaseEntryId,
            flagged: computeDensityFlag(dto.productType, dto.densityValue),
          },
        }),
      );
    }

    const results = await this.prisma.$transaction(operations);
    const purchaseEntry = results[0] as PurchaseEntry;

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
