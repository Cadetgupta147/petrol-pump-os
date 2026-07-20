import {
  IsDateString,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

// Shared `from`/`to` query DTO for any date-range-scoped report endpoint —
// same shape/validation as tally-export's ExportRangeDto (that one is kept
// local to tally-export since it predates this shared version and nothing
// else used it yet; this is the reusable version for reports built after
// it, so the cross-field "to >= from" validator doesn't get re-implemented
// a third time).
@ValidatorConstraint({ name: 'isOnOrAfterFromDateRangeQuery', async: false })
class IsOnOrAfterFromConstraint implements ValidatorConstraintInterface {
  validate(to: string, args: ValidationArguments): boolean {
    const object = args.object as DateRangeQueryDto;
    if (!object.from || !to) {
      // Presence/format of each field is separately enforced by
      // @IsDateString on both properties — don't double-report here.
      return true;
    }
    return new Date(to).getTime() >= new Date(object.from).getTime();
  }

  defaultMessage(): string {
    return '"to" must be on or after "from"';
  }
}

export class DateRangeQueryDto {
  // Expected as YYYY-MM-DD (a full ISO datetime string also passes
  // @IsDateString, but only the date portion is read — see date-range.util.ts).
  @IsDateString()
  from!: string;

  @IsDateString()
  @Validate(IsOnOrAfterFromConstraint)
  to!: string;
}
