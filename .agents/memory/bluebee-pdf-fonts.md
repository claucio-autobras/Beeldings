---
name: jsPDF Unicode fonts
description: Como embutir Roboto nos PDFs do backend e por que alguns nomes ainda mostram "�"
---
- Todos os PDFs jsPDF registram Roboto via `pdf-fonts.ts` (registerPdfFonts + PDF_FONT); fontes TTF em `modules/reports/assets/fonts`, copiadas ao dist via `assets` no nest-cli.json (com watchAssets).
- **Why:** fontes padrão do jsPDF (helvetica) são WinAnsi → acentos viravam "Sýýntese".
- GitHub raw de fontes retorna HTML no firewall; baixar TTF do tarball npm (`@expo-google-fonts/roboto`).
- Nomes com "�" em relatórios NÃO são problema de fonte: U+FFFD está gravado em `DevicePoint.objectName` (corrupção na ingestão BACnet, Latin-1 lido como UTF-8). Follow-up proposto para corrigir ingestão + dados.
- **How to apply:** novo helper de PDF deve chamar registerPdfFonts(doc) e usar `font: PDF_FONT` em todo autoTable/text.
