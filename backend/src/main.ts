import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import helmet from 'helmet';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.use(helmet());

  // Default body-parser limit (100kb) is too small for a base64-encoded
  // ticket photo from the mobile app - bump it for JSON bodies specifically.
  app.useBodyParser('json', { limit: '15mb' });

  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip properties that aren't in the DTO
      transform: true,
    }),
  );

  const port = process.env.PORT || 3001;
  // Bind to loopback only - nginx is the sole intended entry point. Without
  // this the app also listens on the public interface, letting requests
  // reach it directly with attacker-controlled headers (bypassing nginx's
  // X-Real-IP, TLS, and CSP), which would make trusting X-Real-IP above unsafe.
  await app.listen(port, '127.0.0.1');
  console.log(`Backend running on http://localhost:${port}`);
}
bootstrap();
