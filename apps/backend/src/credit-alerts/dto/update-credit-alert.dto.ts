import { IsBoolean } from 'class-validator';

// PATCH /credit-alerts/:id — the "mark send reminder: yes/no" action.
// Does NOT trigger any actual SMS/WhatsApp/push send — Section 11 will
// consume this flag later. Just persists the dealer's decision + timestamp.
export class UpdateCreditAlertDto {
  @IsBoolean()
  reminderRequested!: boolean;
}
