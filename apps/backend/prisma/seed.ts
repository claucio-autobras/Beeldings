import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // Tenant principal — Autobras BlueBee
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'autobras' },
    update: {},
    create: {
      name: 'Autobras BlueBee',
      slug: 'autobras',
    },
  });

  console.log(`✅ Tenant criado: ${tenant.name} (${tenant.id})`);

  // Usuário ADMIN — global, sem vínculo a tenant.
  // Admin é global por design (vê todos os tenants); não deve ser vinculado
  // a um tenant específico, senão a exclusão desse tenant apagaria a conta.
  // Senha do ADMIN: em produção é obrigatório definir ADMIN_SEED_PASSWORD.
  // Em desenvolvimento, cai num padrão apenas para conveniência local.
  if (!process.env.ADMIN_SEED_PASSWORD && process.env.NODE_ENV === 'production') {
    throw new Error(
      'ADMIN_SEED_PASSWORD é obrigatório para semear o usuário ADMIN em produção.',
    );
  }
  const adminPassword = process.env.ADMIN_SEED_PASSWORD ?? 'Autobras@2026';

  // Idempotente e seguro para rodar a cada boot de produção:
  // - Se o admin não existe → cria com a senha do seed.
  // - Se existe mas está sem senha (era Supabase) → define a senha do seed.
  // - Se existe e JÁ TEM senha → NÃO sobrescreve (preserva troca de senha
  //   feita pelo admin via interface; reiniciar o servidor não reseta senha).
  const existingAdmin = await prisma.user.findUnique({
    where: { email: 'admin@autobras.com.br' },
  });

  let admin;
  if (!existingAdmin) {
    admin = await prisma.user.create({
      data: {
        supabaseId: '9570a84c-3e93-452b-aa63-f784c1037a33',
        email: 'admin@autobras.com.br',
        name: 'Admin Autobras',
        role: Role.ADMIN,
        tenantId: null,
        passwordHash: await bcrypt.hash(adminPassword, 10),
      },
    });
  } else if (!existingAdmin.passwordHash) {
    admin = await prisma.user.update({
      where: { email: 'admin@autobras.com.br' },
      data: {
        tenantId: null,
        passwordHash: await bcrypt.hash(adminPassword, 10),
      },
    });
  } else {
    admin = await prisma.user.update({
      where: { email: 'admin@autobras.com.br' },
      data: { tenantId: null },
    });
  }

  console.log(`✅ Usuário ADMIN criado: ${admin.email} (${admin.id})`);
  console.log(`   tenant_id: ${admin.tenantId}`);
  console.log(`   role: ${admin.role}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
