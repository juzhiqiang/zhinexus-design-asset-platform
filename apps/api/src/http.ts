import { randomUUID } from 'node:crypto';
import { Body, Catch, Controller, Get, Headers, HttpCode, Inject, Param, Post, Req, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { ApiError } from '@company/contracts';
import { AuthFailure } from './auth/oidc.js';
import { PlatformError } from './errors.js';
import { Platform } from './platform.js';
import { ReleaseService } from './releases/service.js';
import { BaselineService } from './baselines/service.js';
import { PreviewService } from './preview/service.js';

type Request = { requestId?: string };
@Controller('v1')
export class PlatformController {
  constructor(@Inject(Platform) private readonly platform: Platform) {}
  @Post('preview-grants')
  previewGrant(@Body() body: unknown, @Headers('authorization') auth: string | undefined, @Req() request: Request) {
    return this.platform.run(auth, 'read', request.requestId!, (context, _uploads, db) => new PreviewService(db, this.platform.preview).create(body, context));
  }
  @Post('baselines')
  createBaseline(@Body() body: unknown, @Headers('authorization') auth: string | undefined, @Req() request: Request) {
    return this.platform.run(auth, 'baseline', request.requestId!, (context, _uploads, db) => new BaselineService(db).accept(body, context));
  }
  @Post('variant-releases/:id/deprecate') @HttpCode(200)
  deprecate(@Param('id') id: string, @Body() body: unknown, @Headers('authorization') auth: string | undefined, @Req() request: Request) {
    return this.platform.run(auth, 'deprecate', request.requestId!, (context, _uploads, db) => new BaselineService(db).deprecate(id, body, context));
  }
  @Post('releases') @HttpCode(202)
  createRelease(@Body() body: unknown, @Headers('authorization') auth: string | undefined, @Headers('idempotency-key') key: string | undefined, @Req() request: Request) {
    return this.platform.run(auth, 'upload', request.requestId!, (context, uploads, db) => new ReleaseService(db, uploads).create(body, key, context));
  }
  @Get('releases/:id')
  getRelease(@Param('id') id: string, @Headers('authorization') auth: string | undefined, @Req() request: Request) {
    return this.platform.run(auth, 'read', request.requestId!, (context, uploads, db) => new ReleaseService(db, uploads).get(id, context));
  }
  @Post('releases/:id/retry') @HttpCode(202)
  retryRelease(@Param('id') id: string, @Headers('authorization') auth: string | undefined, @Req() request: Request) {
    return this.platform.run(auth, 'upload', request.requestId!, (context, uploads, db) => new ReleaseService(db, uploads).retry(id, context));
  }
  @Post('uploads')
  createUpload(@Body() body: unknown, @Headers('authorization') auth: string | undefined, @Req() request: Request) {
    return this.platform.run(auth, 'upload', request.requestId!, (context, uploads) => uploads.create(body, context));
  }
  @Post('uploads/:id/complete') @HttpCode(200)
  completeUpload(@Param('id') id: string, @Body() body: unknown, @Headers('authorization') auth: string | undefined, @Req() request: Request) {
    return this.platform.run(auth, 'upload', request.requestId!, (context, uploads) => uploads.complete(id, body, context));
  }
}
@Catch()
export class ErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const request = host.switchToHttp().getRequest<Request>();
    let failure: PlatformError;
    if (error instanceof PlatformError) failure = error;
    else if (error instanceof AuthFailure) failure = new PlatformError(error.code);
    else {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
      const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined;
      failure = new PlatformError(code === '23505' ? 'CONFLICT' : status === 413 ? 'LIMIT_EXCEEDED' :
        status === 400 ? 'INVALID_SCHEMA' : status === 404 ? 'NOT_FOUND' : 'INFRA_UNAVAILABLE');
    }
    const body: ApiError = { code: failure.code, message: failure.code, details: failure.details, requestId: request.requestId ?? randomUUID() };
    host.switchToHttp().getResponse<{ status(code: number): { json(body: ApiError): void } }>().status(failure.status).json(body);
  }
}
