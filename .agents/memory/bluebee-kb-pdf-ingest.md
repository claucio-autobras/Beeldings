---
name: KB PDF ingestion
description: Gotchas ao ingerir PDFs na base de conhecimento (pdf-parse v2, NUL bytes, multer latin1)
---

- pdf-parse v2 (`new PDFParse({data}); await getText()`); separa páginas com marcadores `-- N of M --` que convertemos em quebras de parágrafo.
- Texto extraído de PDF pode conter NUL (0x00) → Postgres rejeita (`invalid byte sequence for encoding "UTF8"`). Sempre remover controles na normalização antes de gravar.
- multer decodifica `originalname` como latin1 → acentos viram mojibake ("ServiÃ§o"); reinterpretar com `Buffer.from(name,'latin1').toString('utf8')`.
- Fluxo: POST /knowledge/extract-pdf só extrai (preview); criação segue no POST /knowledge (json limit 8mb, MAX_CONTENT 1,5M). Reindex insere chunks em lotes multi-linha com timeout de transação folgado.

**Why:** primeiros creates falharam com 500 opaco por 0x00; títulos corrompidos por latin1.
**How to apply:** qualquer nova ponta de ingestão de arquivo/texto externo na KB deve reusar a normalização do PdfExtractService e a decodificação de filename.
