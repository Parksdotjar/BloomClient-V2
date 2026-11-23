export type BackgroundSettings = {
  source: "Solid color" | "Image";
  fit: "Fill" | "Fit";
  opacity: number;
  sidebar: number;
  elements: number;
  blur: number;
  elementBlur: number;
};

export const backgroundDefaults: BackgroundSettings = {
  source: "Solid color", fit: "Fill", opacity: 50, sidebar: 65, elements: 56, blur: 14, elementBlur: 6,
};

export function readBackground(saved?: Partial<BackgroundSettings> | null): BackgroundSettings {
  const number = (key: "opacity" | "sidebar" | "elements" | "blur" | "elementBlur", max: number) => {
    const value = saved?.[key];
    return typeof value === "number" && Number.isFinite(value)
      ? Math.max(0, Math.min(max, Math.round(value))) : backgroundDefaults[key];
  };
  return {
    source: saved?.source === "Image" ? "Image" : "Solid color",
    fit: saved?.fit === "Fit" ? "Fit" : "Fill",
    opacity: number("opacity", 100), sidebar: number("sidebar", 100),
    elements: number("elements", 100), blur: number("blur", 40), elementBlur: number("elementBlur", 40),
  };
}
