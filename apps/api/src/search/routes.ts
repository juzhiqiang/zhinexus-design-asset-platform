import { Body, Controller, Headers, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { Platform } from '../platform.js';
import { SearchService } from './service.js';

@Controller('v1/search')
export class SearchController {
  constructor(@Inject(Platform) private readonly platform: Platform) {}
  @Post('candidates') @HttpCode(200)
  search(@Body() body: unknown, @Headers('authorization') auth: string | undefined,
    @Req() request: { requestId: string }, @Res({ passthrough: true }) response: { setHeader(name: string, value: string): void }) {
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Robots-Tag', 'noindex, nofollow');
    return this.platform.run(auth, 'read', request.requestId, (context, _uploads, db) => new SearchService(db).search(body, context.principal.subject));
  }
}
