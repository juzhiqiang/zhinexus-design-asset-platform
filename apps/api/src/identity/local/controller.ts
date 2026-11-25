import { Body, Controller, Get, Headers, HttpCode, Inject, Post, Query, Res } from '@nestjs/common';
import { Platform } from '../../platform.js';
import { PlatformError } from '../../errors.js';
import { isBrowserForm, loginFailureReason, loginFailureUrl } from './login-page.js';
import type { LocalIdentityService } from './service.js';

/**
 * Local identity endpoints, mounted under `/identity` so the issuer is `<api origin>/identity`.
 * That satisfies `access/oidc.ts`, which requires the discovery document's `issuer` to match the
 * configured issuer exactly and requires all three endpoint URLs to be https and present in the
 * OIDC outbound allow-list.
 */
@Controller('identity')
export class LocalIdentityController {
  constructor(@Inject(Platform) private readonly platform: Platform) {}
  private runtime(): LocalIdentityService {
    if (!this.platform.localIdentity) throw new PlatformError('INFRA_UNAVAILABLE');
    return this.platform.localIdentity;
  }
  /** JSON descriptor of an authorization request; see `LocalIdentityService.describeAuthorization`. */
  @Get('authorize')
  authorizeForm(@Query() query: Record<string, unknown>) {
    // Query and body names follow the OIDC wire format; the service fields are camelCase.
    return this.runtime().describeAuthorization({
      clientId: query['client_id'], redirectUri: query['redirect_uri'], state: query['state'],
      codeChallenge: query['code_challenge'], scope: query['scope'], nonce: query['nonce'],
    });
  }
  /**
   * Accepts the credential form the admin login page submits. The happy path is a redirect to the
   * OIDC callback, exactly like any other authorization endpoint. A rejection cannot be a JSON
   * error page, because the browser is sitting on a form it just posted: a form navigation is sent
   * back to the login page with a closed-set reason instead, and every other client keeps the JSON
   * error it has always received.
   */
  @Post('authorize') @HttpCode(303)
  async authorize(@Body() body: Record<string, unknown>, @Res() response: { redirect(code: number, url: string): void }, @Headers('accept') accept?: string) {
    try {
      const grant = await this.runtime().authorize({
        clientId: body['client_id'], redirectUri: body['redirect_uri'], state: body['state'],
        codeChallenge: body['code_challenge'], scope: body['scope'], nonce: body['nonce'],
        username: body['username'], password: body['password'], newPassword: body['new_password'],
      });
      const url = new URL(grant.redirectUri);
      url.search = new URLSearchParams({ code: grant.code, state: grant.state }).toString();
      response.redirect(303, url.href);
    } catch (error) {
      if (!(error instanceof PlatformError) || !isBrowserForm(accept)) throw error;
      response.redirect(303, loginFailureUrl(this.platform.adminOrigin, body, loginFailureReason(error)));
    }
  }
  /** Direct username/password sign-in without an OIDC redirect roundtrip. */
  @Post('login') @HttpCode(200)
  login(@Body() body: Record<string, unknown>) {
    if (this.platform.localIdentity) {
      return this.platform.localIdentity.passwordLogin({
        username: body['username'], password: body['password'], newPassword: body['new_password'],
      });
    }
    if (this.platform.devAdmin) {
      return this.platform.devAdmin.login(body['username'], body['password']);
    }
    throw new PlatformError('INFRA_UNAVAILABLE');
  }
  @Post('token') @HttpCode(200)
  token(@Body() body: Record<string, unknown>) {
    if (body['grant_type'] !== 'authorization_code') throw new PlatformError('INVALID_SCHEMA');
    return this.runtime().token({ code: body['code'], codeVerifier: body['code_verifier'], clientId: body['client_id'], redirectUri: body['redirect_uri'] });
  }
  @Get('jwks')
  jwks() { return this.runtime().jwks(); }
  @Get('.well-known/openid-configuration')
  discovery() { return this.runtime().discovery(); }
  /** First-login replacement for a platform-issued temporary credential. */
  @Post('password') @HttpCode(200)
  changePassword(@Body() body: Record<string, unknown>) {
    return this.runtime().changePassword({ username: body['username'], currentPassword: body['current_password'], newPassword: body['new_password'] });
  }
}
