import { PrismaClient } from '@prisma/client';
import { provisionCagAutobras } from '../src/modules/scada/application/cag-autobras.provision';

const prisma = new PrismaClient();

provisionCagAutobras(prisma)
  .then((result) => {
    console.log(JSON.stringify(result));
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());