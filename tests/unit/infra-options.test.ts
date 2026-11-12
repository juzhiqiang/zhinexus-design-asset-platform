import { expect,it } from 'vitest';
import { checkOptions } from '../../infra/scripts/check-options.js';
it('makes a non-restarting infrastructure probe explicit and rejects unknown switches',()=>{
  expect(checkOptions([])).toEqual({restart:true});
  expect(checkOptions(['--no-restart'])).toEqual({restart:false});
  expect(()=>checkOptions(['--force'])).toThrow();
});
