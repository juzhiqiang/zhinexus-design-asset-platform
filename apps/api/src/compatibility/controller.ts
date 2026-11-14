import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import { Platform } from '../platform.js';
import { PlatformError } from '../errors.js';
import { CompatibilityService } from './service.js';

type Request = { requestId: string; originalUrl: string };
type Response = { setHeader(name: string, value: string): void };

@Controller('v1')
export class CompatibilityController {
  constructor(@Inject(Platform) private readonly platform: Platform) {}

  @Post('variant-releases/:id/compatibility')
  @HttpCode(201)
  accept(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('authorization') auth: string | undefined,
    @Req() request: Request,
  ) {
    return this.platform.run(auth, 'baseline', request.requestId!, (context, _uploads, db) =>
      new CompatibilityService(db).accept(id, body, context),
    );
  }

  @Get(['variant-releases/:id/compatibility', 'me/variant-releases/:id/compatibility'])
  list(
    @Param('id') id: string,
    @Headers('authorization') auth: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    if (request.originalUrl.startsWith('/v1/me/')) {
      response.setHeader('X-Robots-Tag', 'noindex, nofollow');
      return this.platform.run(auth, 'read', request.requestId!, (context, _uploads, db) =>
        new CompatibilityService(db).list(id, context.principal.subject, context.principal.roles),
      );
    }
    if (!this.platform.db) throw new PlatformError('INFRA_UNAVAILABLE');
    return new CompatibilityService(this.platform.db).list(id, null, []);
  }
}
