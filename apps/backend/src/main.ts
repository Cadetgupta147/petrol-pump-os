import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip properties not declared on the DTO
      transform: true, // auto-convert path/query/body params to DTO types
      forbidNonWhitelisted: true, // reject unexpected fields instead of silently dropping them
    }),
  );
  const port = process.env.API_PORT ?? 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Backend listening on port ${port}`);
}
bootstrap();
