export function checkOptions(args: string[]) {
  if(args.some(arg=>arg!=='--no-restart')) throw new Error('Unknown infrastructure probe option');
  return {restart:!args.includes('--no-restart')};
}
