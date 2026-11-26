import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { Platform } from '../platform.js';
import { PlatformError } from '../errors.js';

type Request = { requestId: string };
@Controller('v1')
export class CategoriesController {
  constructor(@Inject(Platform) private readonly platform: Platform) {}
  @Get('categories')
  list(@Query() query: Record<string, unknown>, @Headers('authorization') auth: string | undefined, @Req() request: Request) {
    return this.platform.runCategories(auth, request.requestId, (service, context) => {
      if (Object.keys(query).some(key => key !== 'includeDisabled') || query['includeDisabled'] !== undefined && !['true', 'false'].includes(query['includeDisabled'] as string)) throw new PlatformError('INVALID_SCHEMA');
      return service.list(query['includeDisabled'] === 'true', context);
    });
  }
  @Post('categories') @HttpCode(201)
  create(@Body() body: unknown, @Headers('authorization') auth: string | undefined, @Req() request: Request) {
    return this.platform.runCategories(auth, request.requestId, (service, context) => service.create(body, context));
  }
  @Post('categories/:id/update') @HttpCode(200)
  update(@Param('id') id: string, @Body() body: unknown, @Headers('authorization') auth: string | undefined, @Req() request: Request) {
    return this.platform.runCategories(auth, request.requestId, (service, context) => service.update(id, body, context));
  }
  @Get('publishing/options')
  publishingOptions(@Headers('authorization') auth: string | undefined, @Req() request: Request) {
    return this.platform.runCategories(auth, request.requestId, (service, context) => service.publishingOptions(context));
  }
  @Post('publishing/components/:id/visibility') @HttpCode(200)
  updateVisibility(@Param('id') id: string, @Body() body: unknown, @Headers('authorization') auth: string | undefined, @Req() request: Request) {
    return this.platform.runCategories(auth, request.requestId, (service, context) => service.updateComponentVisibility(id, body, context));
  }
  @Get('publishing/components/:id/releases')
  componentReleases(@Param('id') id: string, @Headers('authorization') auth: string | undefined, @Req() request: Request) {
    return this.platform.runCategories(auth, request.requestId, (service, context) => service.componentReleaseHistory(id, context));
  }
}
