import { BadRequestException, Body, Controller, Get, INestApplication, Logger, NotFoundException, Post, UnauthorizedException } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { IsString } from 'class-validator';
import request from 'supertest';
import { createValidationPipe } from '../src/validation-pipe';
import { RefusedRequestLoggingFilter, refusedRequestLine } from '../src/refused-request-logging.filter';

class Dto {
  @IsString()
  title!: string;
}

@Controller('t')
class TestController {
  @Post('validated')
  validated(@Body() _dto: Dto) {
    return { ok: true };
  }

  @Post('refused')
  refused() {
    throw new BadRequestException('Needed by cannot be in the past.');
  }

  @Get('missing')
  missing() {
    throw new NotFoundException('Task #9 not found');
  }

  @Get('unauthorized')
  unauthorized() {
    throw new UnauthorizedException();
  }

  @Get('boom')
  boom() {
    throw new Error('internal detail');
  }
}

describe('RefusedRequestLoggingFilter', () => {
  let app: INestApplication;
  let warn: jest.SpyInstance;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [TestController] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.useGlobalPipes(createValidationPipe());
    app.useGlobalFilters(new RefusedRequestLoggingFilter(app.get(HttpAdapterHost).httpAdapter));
    await app.init();
  });
  afterAll(() => app.close());
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());

  it('logs a refusal with its message and leaves the response unchanged', async () => {
    const res = await request(app.getHttpServer()).post('/t/refused?secret=1').send({ password: 'x' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ statusCode: 400, message: 'Needed by cannot be in the past.', error: 'Bad Request' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe('400 POST /t/refused user=-: Needed by cannot be in the past.');
  });

  it('logs validation messages naming the field', async () => {
    const res = await request(app.getHttpServer()).post('/t/validated').send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toEqual(['title must be a string']);
    expect(warn.mock.calls[0][0]).toBe('400 POST /t/validated user=-: title must be a string');
  });

  it('logs 404s but not 401s, 500s or successes', async () => {
    await request(app.getHttpServer()).get('/t/missing').expect(404);
    await request(app.getHttpServer()).get('/t/unauthorized').expect(401);
    const boom = await request(app.getHttpServer()).get('/t/boom');
    expect(boom.status).toBe(500);
    expect(boom.body).toEqual({ statusCode: 500, message: 'Internal server error' });
    await request(app.getHttpServer()).post('/t/validated').send({ title: 'ok' }).expect(201);
    expect(warn.mock.calls.map((c) => c[0])).toEqual(['404 GET /t/missing user=-: Task #9 not found']);
  });

  it('includes the user id when signed in', () => {
    expect(refusedRequestLine(403, { method: 'PATCH', originalUrl: '/api/x/1?q=a', user: { sub: 4 } }, { message: 'Only an Admin can do this.' })).toBe(
      '403 PATCH /api/x/1 user=4: Only an Admin can do this.',
    );
  });
});
