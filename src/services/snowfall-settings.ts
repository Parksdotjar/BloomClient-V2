export type SnowfallSettings = {
  count: number;
  speed: number;
  size: number;
};

export const snowfallLimits = {
  count: { min: 1, max: 48 },
  speed: { min: 25, max: 200 },
  size: { min: 50, max: 250 },
};

export const snowfallDefaults: SnowfallSettings = { count: 18, speed: 100, size: 100 };

export function readSnowfall(saved?: Partial<SnowfallSettings> | null): SnowfallSettings {
  const number = (key: keyof typeof snowfallLimits) => {
    const value = saved?.[key];
    const { min, max } = snowfallLimits[key];
    return typeof value === "number" && Number.isFinite(value)
      ? Math.max(min, Math.min(max, Math.round(value))) : snowfallDefaults[key];
  };
  return {
    count: number("count"),
    speed: number("speed"),
    size: number("size"),
  };
}
