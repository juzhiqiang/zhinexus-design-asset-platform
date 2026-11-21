import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import { ACCESS_SECTIONS, type AccessAction, type AccessSection } from '@company/contracts';
import { Platform } from '../platform.js';
import { PlatformError } from '../errors.js';

@Controller('v1/access-settings')
export class AccessSettingsController {
  constructor(@Inject(Platform) private readonly platform: Platform) {}
  @Get()
  view(@Headers('authorization') auth: string | undefined, @Req() request: { requestId: string }) {
    return this.platform.runAdministrator(auth, request.requestId, (service, context) => service.view(context));
  }
  @Post(':section/:action') @HttpCode(200)
  mutate(@Param('section') section: string, @Param('action') action: string, @Body() body: unknown, @Headers('authorization') auth: string | undefined, @Req() request: { requestId: string }) {
    if (!(ACCESS_SECTIONS as readonly string[]).includes(section) || !['draft','validate','activate','rollback'].includes(action)) throw new PlatformError('NOT_FOUND');
    return this.platform.runAdministrator(auth, request.requestId, (service, context) => service.mutate(section as AccessSection, action as AccessAction, body, context));
  }
}
