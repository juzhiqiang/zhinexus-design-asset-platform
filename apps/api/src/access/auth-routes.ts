import { Body, Controller, Get, Headers, HttpCode, Inject, Post, Query, Req, Res } from '@nestjs/common';
import { Platform } from '../platform.js';
import { PlatformError } from '../errors.js';
import { audit } from '../db/access.js';
type Response = { setHeader(name:string,value:string):void; status(code:number):Response; redirect(code:number,url:string):void; json(body:unknown):void };
const cookie = (header:string | undefined, name:string) => {
  const values = (header ?? '').split(';').map(v => v.trim()).filter(v => v.startsWith(name+'='));
  return values.length === 1 ? values[0]!.slice(name.length+1) : '';
};
@Controller('v1/auth/oidc')
export class CompanyAuthController {
  constructor(@Inject(Platform) private readonly platform:Platform) {}
  private runtime() { if (!this.platform.companyOidc) throw new PlatformError('INFRA_UNAVAILABLE'); return this.platform.companyOidc; }
  private async checked<T>(target:string,requestId:string,operation:()=>Promise<T>):Promise<T> {
    try {return await operation();}
    catch(error) {
      const code=error instanceof Error && 'code' in error ? error.code : undefined;
      if ((code==='UNAUTHENTICATED' || code==='FORBIDDEN') && this.platform.db) await audit(this.platform.db,undefined,'AUTH_DENIED',target,{code},requestId).catch(()=>{});
      throw error;
    }
  }
  @Get('start')
  async start(@Query() query:Record<string,unknown>,@Headers('authorization') auth:string | undefined,@Req() request:{requestId:string},@Res() response:Response) {
    if (Object.keys(query).some(key => !['revision','target'].includes(key)) || Object.values(query).some(value => typeof value !== 'string') || (query.target !== undefined && query.target !== 'gallery' && query.target !== 'admin')) throw new PlatformError('INVALID_SCHEMA');
    const revision = query.revision as string | undefined;
    const target = query.target === 'admin' ? 'admin' : 'gallery';
    if (revision) await this.platform.runAdministrator(auth,request.requestId,async () => true);
    const result = await this.checked('oidc-start',request.requestId,()=>this.runtime().start(revision,undefined,target));
    response.setHeader('Set-Cookie',result.cookie);response.setHeader('Referrer-Policy','no-referrer');response.redirect(303,result.location);
  }
  @Get('callback')
  async callback(@Query() query:Record<string,string>,@Headers('cookie') cookies:string | undefined,@Req() request:{requestId:string},@Res() response:Response) {
    const result = await this.checked('oidc-callback',request.requestId,async()=>{
      if (Object.keys(query).some(key => !['code','state','iss','session_state'].includes(key)) || Object.values(query).some(value => typeof value !== 'string') || !query.code || !query.state) throw new PlatformError('UNAUTHENTICATED');
      return this.runtime().callback(query.state,query.code,cookie(cookies,'__Host-oidc'),query.iss);
    });
    response.setHeader('Set-Cookie',result.cookie ?? '__Host-oidc=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax');
    response.setHeader('Referrer-Policy','no-referrer');response.redirect(303,result.location);
  }
  @Post('candidate-start') @HttpCode(200)
  candidateStart(@Body() body:unknown,@Headers('authorization') auth:string | undefined,@Req() request:{requestId:string}) {
    return this.platform.runAdministrator(auth,request.requestId,(_service,context)=>this.runtime().candidateTicket(body,context.principal));
  }
  @Get('candidate')
  async candidate(@Query('ticket') ticket:string,@Req() request:{requestId:string},@Res() response:Response) {
    const result=await this.checked('oidc-candidate',request.requestId,()=>this.runtime().consumeCandidate(ticket));
    response.setHeader('Set-Cookie',result.cookie);response.setHeader('Referrer-Policy','no-referrer');response.redirect(303,result.location);
  }
  @Get('session')
  async session(@Headers('authorization') auth:string | undefined,@Req() request:{requestId:string}) {
    const principal = await this.checked('oidc-session',request.requestId,()=>this.platform.authenticate(auth));
    const administrator = this.platform.access?.options.administrators.some(a => a.issuer === principal.issuer && a.subject === principal.identitySubject) ?? false;
    return {authenticated:true,administrator,subject:principal.subject,roles:principal.roles};
  }
  @Get('cli')
  async cli(@Query('revision') revision:string | undefined,@Headers('authorization') auth:string | undefined,@Req() request:{requestId:string}) {
    if (revision) await this.platform.runAdministrator(auth,request.requestId,async () => true);
    return this.checked('oidc-cli',request.requestId,()=>this.runtime().cliMetadata(revision));
  }
  @Post('candidate-cli') @HttpCode(200)
  candidateCli(@Body() body:unknown,@Headers('authorization') auth:string | undefined,@Req() request:{requestId:string}) {
    return this.platform.runAdministrator(auth,request.requestId,() => this.runtime().candidateCli(body));
  }
  @Post('logout') @HttpCode(200)
  async logout(@Headers('cookie') cookies:string | undefined,@Res() response:Response) {
    const token = cookie(cookies,'__Host-platform');
    if (token && this.platform.db) await this.platform.db.query('DELETE FROM oidc_sessions WHERE token_hash=$1',[(await import('./oidc.js')).digest(token)]);
    response.setHeader('Set-Cookie','__Host-platform=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=None');response.json({authenticated:false});
  }
}
