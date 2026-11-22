import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { Platform } from '../platform.js';
import { PlatformError } from '../errors.js';

type Request = { requestId: string };
@Controller('v1/managed-accounts')
export class ManagedAccountsController {
  constructor(@Inject(Platform) private readonly platform: Platform) {}
  private service() {
    if (!this.platform.accounts) throw new PlatformError('INFRA_UNAVAILABLE');
    return this.platform.accounts;
  }
  @Get()
  list(@Query() query: Record<string, unknown>, @Headers('authorization') auth: string | undefined, @Req() request: Request) {
    return this.platform.runManaged(auth, request.requestId, (service, context) => service.list({
      ...(typeof query['query'] === 'string' ? { query: query['query'] } : {}),
      ...(query['enabled'] === 'true' ? { enabled: true } : query['enabled'] === 'false' ? { enabled: false } : {}),
      ...(Number.isInteger(Number(query['page'])) && Number(query['page']) > 0 ? { page: Number(query['page']) } : {}),
      ...(Number.isInteger(Number(query['pageSize'])) && Number(query['pageSize']) > 0 ? { pageSize: Number(query['pageSize']) } : {}),
    }, context));
  }
  @Get('audit')
  audit(@Headers('authorization') auth: string | undefined, @Req() request: Request) {
    return this.platform.runManaged(auth, request.requestId, (service, context) => service.auditTrail(context));
  }
  @Get(':id')
  detail(@Param('id') id: string, @Headers('authorization') auth: string | undefined, @Req() request: Request) {
    return this.platform.runManaged(auth, request.requestId, (service, context) => service.detail(id, context));
  }
  @Post() @HttpCode(201)
  create(@Body() body: unknown, @Headers('authorization') auth: string | undefined, @Req() request: Request) {
    return this.platform.runManaged(auth, request.requestId, (service, context) => service.create(body, context));
  }
  @Post(':id/password') @HttpCode(200)
  setPassword(@Param('id') id: string, @Body() body: unknown, @Headers('authorization') auth: string | undefined, @Req() request: Request) {
    const password = body && typeof body === 'object' && !Array.isArray(body) ? (body as { password?: unknown }).password : undefined;
    return this.platform.runManaged(auth, request.requestId, (service, context) => service.setPassword(id, body, typeof password === 'string' ? password : '', context));
  }
  @Post(':id/update') @HttpCode(200)
  update(@Param('id') id: string, @Body() body: unknown, @Headers('authorization') auth: string | undefined, @Req() request: Request) {
    return this.platform.runManaged(auth, request.requestId, (service, context) => service.update(id, body, context));
  }
  @Post(':id/disable') @HttpCode(200)
  disable(@Param('id') id: string, @Body() body: unknown, @Headers('authorization') auth: string | undefined, @Req() request: Request) {
    return this.platform.runManaged(auth, request.requestId, (service, context) => service.disable(id, body, context));
  }
  @Post(':id/enable') @HttpCode(200)
  enable(@Param('id') id: string, @Body() body: unknown, @Headers('authorization') auth: string | undefined, @Req() request: Request) {
    return this.platform.runManaged(auth, request.requestId, (service, context) => service.enable(id, body, context));
  }
  @Post(':id/force-logout') @HttpCode(200)
  forceLogout(@Param('id') id: string, @Body() body: unknown, @Headers('authorization') auth: string | undefined, @Req() request: Request) {
    return this.platform.runManaged(auth, request.requestId, (service, context) => service.forceLogout(id, body, context));
  }
}
