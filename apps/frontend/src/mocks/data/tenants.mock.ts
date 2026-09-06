export interface Tenant {
  id: string;
  name: string;
  slug: string;
  active: boolean;
}

export const mockTenants: Tenant[] = [
  { id: 'tenant-autobras', name: 'Empresa Demo', slug: 'empresa-demo', active: true },
  { id: 'tenant-shopb',    name: 'Shop B Ltda',  slug: 'shop-b',       active: true },
];
