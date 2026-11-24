import type { Framework } from '@company/contracts';

export type ComponentPropSpec = {
  name: string;
  type: string;
  required: boolean;
  defaultValue?: string;
  description: string;
};

export type ComponentEventSpec = {
  name: string;
  payload: string;
  description: string;
};

export type ComponentVariantMeta = {
  variantReleaseId: string;
  variantId: string;
  framework: Framework;
  frameworkName: string;
  frameworkVersion?: string;
  packageName: string;
  packageVersion: string;
  exportName: string;
  exportPath: string;
  importCode: string;
  installCommand: string;
  availability?: 'Ready' | 'DEPRECATED';
  reportSource?: 'local-automatic' | 'manual-upload' | 'none';
  baselineStatus?: 'unconfirmed' | 'accepted' | 'incompatible';
  indexStatus?: 'pending' | 'indexed' | 'failed';
  props: ComponentPropSpec[];
  events: ComponentEventSpec[];
  echartsVersion?: string;
};

export type ComponentCatalogItem = {
  id: string;
  name: string;
  chineseName: string;
  category: string;
  description: string;
  variants: ComponentVariantMeta[];
  defaultVariant: ComponentVariantMeta;
};
