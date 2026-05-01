"use client";

/**
 * Dependency-free SVG sparkline.
 *
 * Used by the admin Shop risk profile to render the 13-week dispute
 * velocity trend (PRD §9). Avoids pulling in Recharts / Polaris-Viz —
 * the codebase has no chart library yet and a 13-point line is too
 * small to justify the dep weight.
 *
 * Renders a smooth polyline with a subtle area fill. When all values
 * are zero, it shows a flat baseline rather than nothing — a visible
 * "no disputes" line is more informative than an empty box.
 */

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
  ariaLabel?: string;
}

export function Sparkline({
  data,
  width = 240,
  height = 48,
  stroke = "#1D4ED8",
  fill = "rgba(29, 78, 216, 0.1)",
  ariaLabel,
}: SparklineProps) {
  if (data.length === 0) {
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={ariaLabel ?? "No data"}
      >
        <line
          x1={0}
          y1={height - 1}
          x2={width}
          y2={height - 1}
          stroke="#E2E8F0"
          strokeWidth={1}
        />
      </svg>
    );
  }

  const max = Math.max(...data, 1);
  const min = 0;
  const range = max - min || 1;
  const stepX = data.length === 1 ? 0 : width / (data.length - 1);

  const points = data.map((value, i) => {
    const x = i * stepX;
    const y = height - ((value - min) / range) * (height - 4) - 2;
    return { x, y };
  });

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");

  const areaPath = `${linePath} L${width.toFixed(1)} ${height} L0 ${height} Z`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel ?? `Trend with ${data.length} data points`}
    >
      <path d={areaPath} fill={fill} />
      <path d={linePath} fill="none" stroke={stroke} strokeWidth={1.5} />
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={1.75} fill={stroke} />
      ))}
    </svg>
  );
}
