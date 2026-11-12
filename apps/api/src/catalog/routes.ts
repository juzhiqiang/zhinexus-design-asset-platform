import { Controller, Get, Headers, Inject, Param, Query, Req, Res } from '@nestjs/common';
import { Platform } from '../platform.js';
import { PlatformError } from '../errors.js';
import { CatalogService } from './service.js';

type Request = { requestId: string; originalUrl: string };
type Response = { setHeader(name: string, value: string): void; send(bytes: Buffer): void };
@Controller('v1')
export class CatalogController {
  constructor(@Inject(Platform) private readonly platform: Platform) {}
  private run<T>(auth: string | undefined, request: Request, response: Response, operation: (service: CatalogService, subject: string|null) => Promise<T>): Promise<T> {
    response.setHeader('Cache-Control', 'no-store');
    if (request.originalUrl.startsWith('/v1/me/')) {
      response.setHeader('X-Robots-Tag', 'noindex, nofollow');
      return this.platform.run(auth, 'read', request.requestId, (context, _uploads, db) => operation(new CatalogService(db, this.platform.store), context.principal.subject));
    }
    if (!this.platform.db) throw new PlatformError('INFRA_UNAVAILABLE');
    return operation(new CatalogService(this.platform.db, this.platform.store), null);
  }
  @Get(['components', 'me/components'])
  list(@Query() query: unknown, @Headers('authorization') auth: string | undefined, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.run(auth, req, res, (service, subject) => service.list(query, subject));
  }
  @Get(['variants/:id/releases/:version', 'me/variants/:id/releases/:version'])
  detail(@Param('id') id: string, @Param('version') version: string, @Headers('authorization') auth: string | undefined, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.run(auth, req, res, (service, subject) => service.detail(id, version, subject));
  }
  @Get(['variants/:id/releases/:version/artifacts', 'me/variants/:id/releases/:version/artifacts'])
  async artifact(@Param('id') id: string, @Param('version') version: string, @Query('path') path: unknown, @Headers('authorization') auth: string | undefined, @Req() req: Request, @Res() res: Response) {
    const result = await this.run(auth, req, res, (service, subject) => service.artifact(id, version, path, subject));
    res.setHeader('Content-Type', result.mime);
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.send(Buffer.from(result.bytes));
  }
  @Get(['variants/:id/releases/:version/reports', 'me/variants/:id/releases/:version/reports'])
  reports(@Param('id') id: string, @Param('version') version: string, @Headers('authorization') auth: string | undefined, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.run(auth, req, res, (service, subject) => service.reports(id, version, subject));
  }
}
