import { Controller, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { TallyExportService } from './tally-export.service';
import { ExportRangeDto } from './dto/export-range.dto';

// Section 10 — Tally XML export (Bills -> Sales Vouchers, Payments ->
// Receipt Vouchers, Customers -> Ledger masters). Also feeds the "Tally
// export log" report row (Section 12) via TallyExportLog, written inside
// TallyExportService.generateXml().
//
// Auth: every route below requires a valid JWT (global JwtAuthGuard, see
// app.module.ts). No @Roles() restriction — per Section 2, Accountant has
// explicit "export to Tally" access and Owner has full access anyway, same
// reasoning as BillsController/CreditConfigController.
@Controller('tally-export')
export class TallyExportController {
  constructor(private readonly tallyExportService: TallyExportService) {}

  @Get('xml')
  async exportXml(
    @Query() dto: ExportRangeDto,
    @Res() res: Response,
  ): Promise<void> {
    const { xml, filename } = await this.tallyExportService.generateXml(dto);

    res.set({
      'Content-Type': 'application/xml',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    res.send(xml);
  }
}
