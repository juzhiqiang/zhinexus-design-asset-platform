import { Body, Controller, Headers, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { Platform } from '../platform.js';
import { MatchingService } from './service.js';

@Controller('v1/matching')
export class MatchingController {
  constructor(@Inject(Platform) private readonly platform: Platform) {}
  @Post('plans') @HttpCode(200)
  plan(@Body() body: unknown, @Headers('authorization') auth: string | undefined,
    @Req() request: { requestId: string }, @Res({ passthrough: true }) response: { setHeader(name: string, value: string): void }) {
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Robots-Tag', 'noindex, nofollow');
    return this.platform.run(auth, 'read', request.requestId, (context, _uploads, db) =>
      new MatchingService(db, this.platform.store).plan(body, context.principal.subject));
  }
}
