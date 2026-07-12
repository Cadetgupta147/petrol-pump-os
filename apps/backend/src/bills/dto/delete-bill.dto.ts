import { IsString } from 'class-validator';

// DELETE /bills/:id — no auth yet, so the actor must be passed explicitly,
// same pattern as enteredById on create / editedById on edit.
export class DeleteBillDto {
  @IsString()
  deletedById!: string;
}
