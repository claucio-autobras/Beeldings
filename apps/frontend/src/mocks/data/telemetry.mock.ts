export interface TelemetryPoint {
  hour: string;
  chillerTemp: number;
  buildingTemp: number;
}

function seed(hour: number): number {
  return Math.sin(hour * 1.3) * 0.5 + Math.cos(hour * 0.7) * 0.3;
}

export const mockTelemetry24h: TelemetryPoint[] = Array.from({ length: 24 }, (_, h) => {
  const label = `${String(h).padStart(2, '0')}:00`;
  const nightCooldown = h < 6 || h > 22 ? -0.8 : 0;
  const daytimeLoad = h >= 8 && h <= 18 ? (h - 8) * 0.06 : 0;

  return {
    hour: label,
    chillerTemp: parseFloat((7.0 + seed(h) * 1.2 + daytimeLoad * 0.3 + nightCooldown * 0.3).toFixed(1)),
    buildingTemp: parseFloat((21.5 + seed(h + 3) * 1.5 + daytimeLoad * 1.2 + nightCooldown).toFixed(1)),
  };
});
