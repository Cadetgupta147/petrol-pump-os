import {
  IsDateString,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

// Section 10 — Tally XML export date-range query params (GET /tally-export/xml).
//
// Cross-field rule (from <= to) can't be expressed with a single-property
// class-validator decorator, so it's a small custom @ValidatorConstraint,
// same general approach class-validator itself recommends for cross-field
// checks — kept local to this DTO rather than a shared decorator since
// nothing else in this codebase needs it yet.
@ValidatorConstraint({ name: 'isOnOrAfterFrom', async: false })
class IsOnOrAfterFromConstraint implements ValidatorConstraintInterface {
  validate(to: string, args: ValidationArguments): boolean {
    const object = args.object as ExportRangeDto;
    if (!object.from || !to) {
      // Presence/format of each field is separately enforced by @IsDateString
      // on both properties — don't double-report here.
      return true;
    }
    return new Date(to).getTime() >= new Date(object.from).getTime();
  }

  defaultMessage(): string {
    return '"to" must be on or after "from"';
  }
}

export class ExportRangeDto {
  // Expected as YYYY-MM-DD (a full ISO datetime string also passes
  // @IsDateString, but TallyExportService only reads the date portion).
  @IsDateString()
  from!: string;

  @IsDateString()
  @Validate(IsOnOrAfterFromConstraint)
  to!: string;
}
