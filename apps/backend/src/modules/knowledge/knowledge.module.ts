import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { KnowledgeController } from './knowledge.controller.js';
import { KnowledgeService } from './knowledge.service.js';
import { EmbeddingsService } from './embeddings.service.js';
import { PdfExtractService } from './pdf-extract.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [KnowledgeController],
  providers: [KnowledgeService, EmbeddingsService, PdfExtractService],
  exports: [KnowledgeService, EmbeddingsService],
})
export class KnowledgeModule {}
