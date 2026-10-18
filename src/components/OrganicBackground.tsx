import { memo, useId, type ReactNode } from "react";
import "./organic-background.css";

export const LIVE_BACKGROUNDS = [
  { id: "aurora", name: "Aurora" }, { id: "tide", name: "Tide" },
  { id: "bloom", name: "Bloom" }, { id: "dunes", name: "Dunes" },
  { id: "mist", name: "Mist" }, { id: "petals", name: "Petals" },
  { id: "ripple", name: "Ripple" }, { id: "silk", name: "Silk" },
  { id: "lagoon", name: "Lagoon" }, { id: "ribbons", name: "Ribbons" },
  { id: "halo", name: "Halo" }, { id: "contour", name: "Contour" },
] as const;

type OrganicStyle = (typeof LIVE_BACKGROUNDS)[number]["id"];

/** One composition for both the thumbnail and live canvas. No image requests or filters. */
export const OrganicBackground = memo(function OrganicBackground({ style, preview = false }: { style: OrganicStyle; preview?: boolean }) {
  const id = "organic-" + useId().replace(/:/g, "");
  const paint = (name: string) => `url(#${id}-${name})`;
  const sheet = paint("sheet");
  const fold = paint("fold");
  const edge = paint("edge");
  const haze = paint("haze");
  let artwork: ReactNode;

  switch (style) {
    case "aurora":
      artwork = <>
        <g className="organic-motion">
          <path fill={haze} d="M-160 320C150 20 350 470 670 210S1110 90 1420-150V620H-160Z" />
          {[0, 1, 2, 3, 4, 5, 6].map(n => <path key={n} transform={`translate(${n * 22} ${n * -13})`} fill={sheet} opacity={.72 - n * .065} d="M-140 240C160-10 240 460 550 245S910 155 1340-120L1360-60C960 240 820 95 560 310S160 80-140 320Z" />)}
        </g>
        <path className="organic-motion-secondary" fill={fold} opacity=".65" d="M-100 610C250 230 430 680 790 420S1090 350 1350 150V800H-100Z" />
      </>;
      break;
    case "tide":
      artwork = <g className="organic-motion">
        <path fill={sheet} d="M-80 410C180 540 230 125 530 205S900 530 1300 220V800H-80Z" />
        <path fill={fold} d="M-80 455C180 570 310 280 560 300S920 570 1300 335V800H-80Z" />
        <path fill={sheet} d="M-80 565C220 390 350 510 580 470S950 290 1300 470V800H-80Z" />
        <path fill={fold} d="M-80 610C300 420 450 645 730 535S1080 490 1300 550V800H-80Z" />
        <path fill="none" stroke={edge} strokeWidth="2" d="M-80 410C180 540 230 125 530 205S900 530 1300 220M-80 565C220 390 350 510 580 470S950 290 1300 470" />
      </g>;
      break;
    case "bloom":
      artwork = <g className="organic-motion" transform="translate(770 360)">
        {Array.from({ length: 9 }, (_, n) => <g key={n} transform={`rotate(${n * 40})`}>
          <path fill={fold} stroke={edge} strokeWidth=".8" d="M0 40C-240 15-370-180-235-300C-70-420 175-175 0 40Z" />
          <path fill={sheet} opacity=".62" d="M0 40C-65-55-150-115-235-300C-35-180 80-75 0 40Z" />
        </g>)}
        {Array.from({ length: 6 }, (_, n) => <path key={n} transform={`rotate(${n * 60 + 15}) scale(.42)`} fill={sheet} d="M0 40C-240 15-370-180-235-300C-70-420 175-175 0 40Z" />)}
      </g>;
      break;
    case "dunes":
      artwork = <g className="organic-motion">
        <path fill={fold} d="M-100 320C270 20 610 530 1320 150V800H-100Z" />
        <path fill={sheet} d="M-100 480C170 85 470 390 730 380S1140 190 1320 340V800H-100Z" />
        <path fill={fold} d="M-100 480C240 320 400 670 820 470S1110 280 1320 340V800H-100Z" />
        <path fill={sheet} d="M-100 690C210 420 310 450 590 550S1000 490 1320 580V800H-100Z" />
        <path fill="none" stroke={edge} strokeWidth="1.6" d="M-100 480C170 85 470 390 730 380S1140 190 1320 340M-100 690C210 420 310 450 590 550S1000 490 1320 580" />
      </g>;
      break;
    case "mist":
      artwork = <>
        <ellipse className="organic-motion-secondary" fill={haze} cx="880" cy="190" rx="650" ry="400" />
        <g className="organic-motion">
          <path fill={paint("veil")} d="M-100 470C180 70 410 450 670 310S1030 170 1300 280V800H-100Z" />
          <path fill={paint("veil")} opacity=".65" d="M-100 540C80 390 280 590 520 420S890 450 1300 320V800H-100Z" />
          <path fill={paint("veil")} opacity=".8" d="M-100 590C230 390 510 710 810 510S1130 460 1300 420V800H-100Z" />
        </g>
      </>;
      break;
    case "petals":
      artwork = <g className="organic-motion">
        <path fill={fold} d="M660 790C190 640 10 220 130-120C550 30 800 320 660 790Z" />
        <path fill={sheet} d="M660 790C430 360 610 30 1050-140C1070 350 960 600 660 790Z" />
        <path fill={fold} d="M660 790C720 440 1000 340 1390 390C1180 730 970 830 660 790Z" />
        <path fill={sheet} opacity=".8" d="M660 790C280 870 35 690-90 390C290 350 600 470 660 790Z" />
        <path fill="none" stroke={edge} strokeWidth="1.2" d="M130-120C420 260 620 570 660 790C700 380 870 80 1050-140M660 790C920 500 1110 410 1390 390" />
      </g>;
      break;
    case "ripple":
      artwork = <g className="organic-motion" transform="translate(745 350) rotate(-24)">
        <ellipse fill={haze} rx="700" ry="390" />
        {Array.from({ length: 15 }, (_, n) => <ellipse key={n} cx={Math.sin(n * .6) * 18} cy={n * 3} rx={60 + n * 45} ry={25 + n * 24} fill="none" stroke={n % 3 === 0 ? sheet : edge} strokeWidth={n % 3 === 0 ? 8 : 2} opacity={1 - n * .04} />)}
      </g>;
      break;
    case "silk":
      artwork = <g className="organic-motion">
        <path fill={fold} d="M80-120C720 50 90 560 810 800H1400V-120Z" />
        <path fill={sheet} d="M330-120C1070 140 280 430 1050 800H1400V-120Z" />
        <path fill={fold} d="M410-120C1210 180 370 490 1130 800H1400V-120Z" />
        <path fill={sheet} d="M800-120C1390 80 740 360 1370 670L1510 800V-120Z" />
        <path fill="none" stroke={edge} strokeWidth="1.4" d="M330-120C1070 140 280 430 1050 800M800-120C1390 80 740 360 1370 670" />
      </g>;
      break;
    case "lagoon":
      artwork = <g className="organic-motion" transform="translate(730 330) rotate(-18)">
        {[1.9, 1.65, 1.4, 1.16, .94, .74].map((scale, n) => <path key={n} transform={`scale(${scale})`} fill={paint("pool")} stroke={edge} strokeWidth="1" d="M-280-120C-200-280 110-230 200-125S430 70 260 180S-90 130-230 180S-400 25-280-120Z" />)}
      </g>;
      break;
    case "ribbons":
      artwork = <>
        <g className="organic-motion-secondary" fill={fold}>
          <path d="M-100 110C320 630 680-290 1320 170L1320 300C700-180 340 720-100 250Z" />
          <path d="M-100 550C340 80 740 900 1320 380V520C730 980 310 240-100 690Z" />
        </g>
        <g className="organic-motion" fill={sheet} stroke={edge} strokeWidth="1.2">
          <path d="M-100 240C290 800 700-130 1320 300V380C700-30 300 850-100 340Z" />
          <path d="M-100 100C300-170 700 720 1320 550V650C710 790 280-50-100 180Z" />
        </g>
      </>;
      break;
    case "halo":
      artwork = <g className="organic-motion" transform="translate(760 360) rotate(-32)">
        <ellipse fill={haze} rx="540" ry="360" />
        <ellipse fill="none" stroke={fold} strokeWidth="105" rx="300" ry="265" />
        <ellipse fill="none" stroke={sheet} strokeWidth="42" rx="318" ry="265" />
        <ellipse fill="none" stroke={edge} strokeWidth="1.8" rx="340" ry="286" />
        <ellipse fill="none" stroke={edge} strokeWidth="1" opacity=".35" rx="385" ry="325" />
      </g>;
      break;
    case "contour":
      artwork = <g className="organic-motion" transform="translate(715 355) rotate(-12)">
        <path fill={haze} d="M-300-260C-20-370 100-80 340-160S650 120 300 260S100 100-180 230S-650-90-300-260Z" />
        {Array.from({ length: 21 }, (_, n) => <use key={n} href={`#${id}-contour`} transform={`scale(${.22 + n * .095})`} fill="none" stroke={n % 4 === 0 ? sheet : edge} strokeWidth={n % 4 === 0 ? 4 : 1.7} opacity={1 - n * .022} />)}
      </g>;
      break;
  }

  return <span className={`organic-background ${preview ? "organic-preview" : "organic-live"}`} data-style={style} aria-hidden="true">
    <svg viewBox="0 0 1200 675" preserveAspectRatio="xMidYMid slice" focusable="false">
      <defs>
        {style === "contour" && <path id={`${id}-contour`} className="organic-contour-shape" d="M-300-260C-20-370 100-80 340-160S650 120 300 260S100 100-180 230S-650-90-300-260Z" />}
        <linearGradient id={`${id}-sheet`} x1="0" y1="0" x2=".75" y2="1">
          <stop className="organic-stop-light" />
          <stop offset=".2" className="organic-stop-accent" />
          <stop offset=".55" className="organic-stop-mid" />
          <stop offset="1" className="organic-stop-dark" />
        </linearGradient>
        <linearGradient id={`${id}-fold`} x1=".2" y1="0" x2=".8" y2="1">
          <stop className="organic-stop-mid" />
          <stop offset=".18" className="organic-stop-accent" />
          <stop offset=".48" className="organic-stop-dark" />
          <stop offset="1" stopColor="#05080b" />
        </linearGradient>
        <linearGradient id={`${id}-edge`} x1="0" y1="0" x2="1" y2=".7">
          <stop className="organic-stop-light" stopOpacity=".65" />
          <stop offset=".45" className="organic-stop-accent" stopOpacity=".4" />
          <stop offset="1" className="organic-stop-accent" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`${id}-haze`}>
          <stop className="organic-stop-accent" stopOpacity=".35" />
          <stop offset="1" className="organic-stop-accent" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-veil`} x1="0" y1="0" x2=".15" y2="1">
          <stop className="organic-stop-light" stopOpacity=".5" />
          <stop offset=".15" className="organic-stop-accent" stopOpacity=".3" />
          <stop offset=".7" className="organic-stop-mid" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}-pool`} x1="0" y1="0" x2="1" y2=".85">
          <stop className="organic-stop-mid" />
          <stop offset=".15" className="organic-stop-accent" />
          <stop offset=".45" className="organic-stop-mid" />
          <stop offset="1" className="organic-stop-dark" />
        </linearGradient>
        <radialGradient id={`${id}-ambient`} cx=".7" cy=".3" r=".85">
          <stop className="organic-stop-mid" stopOpacity=".4" />
          <stop offset="1" stopColor="#040609" />
        </radialGradient>
      </defs>
      <rect width="1200" height="675" fill={paint("ambient")} />
      <g className={["aurora", "mist", "ripple", "halo", "contour"].includes(style) ? "organic-breathe" : undefined}>{artwork}</g>
    </svg>
  </span>;
});
