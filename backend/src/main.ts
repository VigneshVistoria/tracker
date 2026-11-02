import 'reflect-metadata';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { createValidationPipe } from './validation-pipe';
import { RefusedRequestLoggingFilter } from './refused-request-logging.filter';
import helmet from 'helmet';

async function bootstrap() {
  // rawBody: the GitHub webhook's signature is checked against the exact
  // bytes received (req.rawBody).
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  app.use(helmet());

  // Default body-parser limit (100kb) is too small for a base64-encoded
  // ticket photo from the mobile app - bump it for JSON bodies specifically.
  app.useBodyParser('json', { limit: '15mb' });

  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  });

  app.useGlobalPipes(createValidationPipe());
  // Logs the reason for every refused (4xx) request - see the filter.
  app.useGlobalFilters(new RefusedRequestLoggingFilter(app.get(HttpAdapterHost).httpAdapter));

  const port = process.env.PORT || 3001;
  // Bind to loopback only - nginx is the sole intended entry point. Without
  // this the app also listens on the public interface, letting requests
  // reach it directly with attacker-controlled headers (bypassing nginx's
  // X-Real-IP, TLS, and CSP), which would make trusting X-Real-IP above unsafe.
  await app.listen(port, '127.0.0.1');
  console.log(`Backend running on http://localhost:${port}`);
}
bootstrap();
