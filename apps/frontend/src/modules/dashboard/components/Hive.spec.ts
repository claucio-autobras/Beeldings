import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const hiveSource = readFileSync(join(__dirname, 'Hive.tsx'), 'utf8');
const globalStyles = readFileSync(join(__dirname, '../../../app/globals.css'), 'utf8');
const tonesSource = hiveSource.slice(
  hiveSource.indexOf('const TONS'),
  hiveSource.indexOf('export interface HiveSatellite'),
);

describe('Hive — composição hexagonal dos KPIs', () => {
  it('usa uma forma exclusiva nas duas camadas visuais de cada célula', () => {
    expect(hiveSource).toContain("className={cn('hive-hex absolute inset-0'");
    expect(hiveSource).toContain("'hive-hex absolute inset-[1.5px]");
    expect(hiveSource).not.toContain("className={cn('hex absolute inset-0'");
    expect(hiveSource).toContain('style={{ clipPath: HIVE_HEX_CLIP }}');
  });

  it('mantém o recorte da Hive protegido contra seletores de superfícies legadas', () => {
    expect(globalStyles).toContain('.hive-hex');
    expect(globalStyles).toContain(
      'clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%) !important',
    );
  });

  it('suaviza o claro e preserva contraste no tema escuro', () => {
    expect(hiveSource).toContain("face: 'bg-[#F7DDE0] dark:bg-[#762B35]'");
    expect(hiveSource).toContain("face: 'bg-[#FBE8D8] dark:bg-[#75431F]'");
    expect(hiveSource).toContain("face: 'bg-[#DDF3F6] dark:bg-[#145B67]'");
    expect(hiveSource).toContain("face: 'bg-[#E6EDF1] dark:bg-[#1D293D]'");
    expect(hiveSource).toContain("texto: 'text-[#7F202B] dark:text-[#FFF1F2]'");
    expect(hiveSource).toContain("rotulo: 'text-[#8C303A]/85 dark:text-[#FFE4E6]/90'");
    expect(hiveSource).toContain("subtexto: 'text-[#8C303A]/75 dark:text-[#FECDD3]/85'");
    expect(tonesSource).toContain('dark:bg-');
    expect(tonesSource).toContain('dark:text-');
    expect(hiveSource).toContain("bg-[radial-gradient(circle,rgba(14,116,144,.10)");
    expect(hiveSource).toContain("text-[11px] font-bold uppercase");
    expect(hiveSource).toContain("contentClassName={s.id === 'ack' ? 'px-[4%]' : undefined}");
    expect(hiveSource).toContain("s.id === 'ack'\n                        ? 'whitespace-nowrap text-[9px] tracking-[.02em]'");
    expect(hiveSource).not.toContain('text-muted-foreground">{center.label}');
    expect(hiveSource).not.toContain('text-muted-foreground">{s.label}');
  });

  it('dimensiona a geometria inteira dentro da coluna, sem canvas fixo ou overflow', () => {
    expect(hiveSource).toContain('className="absolute inset-0"');
    expect(hiveSource).toContain("width: '41.18%'");
    expect(hiveSource).toContain("width: '27.45%'");
    expect(hiveSource).not.toContain('h-[388px] w-[408px]');
    expect(hiveSource).not.toContain('transform: \'translate(-50%, -50%) scale');
    expect(hiveSource).not.toContain('overflow-hidden');
  });
});