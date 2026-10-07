import { ValidationPipe } from '@nestjs/common';

// The app-wide request validation - used by main.ts and by the test app
// (test/setup/test-app.ts), so tests always validate exactly like
// production.
export function createValidationPipe() {
  return new ValidationPipe({
    whitelist: true, // strip properties that aren't in the DTO
    transform: true,
  });
}
