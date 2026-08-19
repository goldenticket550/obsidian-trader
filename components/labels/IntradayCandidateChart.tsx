"use client";

import { useEffect, useMemo, useState } from "react";
import { getEasternTimePartsForCandleTime } from "@/lib/market-data/easternTime";
import type { ArchiveLabelChartData, LabelChartLevelKind } from "@/lib/replay/archiveLabelChart";

const WIDTH = 1160;
const PRICE_TOP = 20;
const PRICE_HEIGHT = 330;
const VOLUME_TOP = 380;
const VOLUME_HEIGHT = 92;
const HEIGHT = 500;

const LEVEL_COLORS: Record<LabelChartLevelKind, string> = {
  hod: "#45c58a",
  lod: "#e05252",
  premarket_high: "#d6a63f",
  premarket_low: "#d6a63f",
  prior_close: "#aab4bf",
  opening_range_high: "#7aa2f7",
  opening_range_low: "#7aa2f7",
};

function easternLabel(time: number): string {
  const minute = getEasternTimePartsForCandleTime(time).minutesSinceMidnight;
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

export function IntradayCandidateChart({
  tradingDate,
  symbol,
  becameInteresting,
}: {
  tradingDate: string;
  symbol: string;
  becameInteresting: string;
}) {
  const [chart, setChart] = useState<ArchiveLabelChartData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setChart(null);
    setError(null);
    const params = new URLSearchParams({ date: tradingDate, symbol, becameInteresting });
    void fetch(`/api/labels/chart?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Chart unavailable");
        setChart(body.chart as ArchiveLabelChartData);
      })
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => controller.abort();
  }, [becameInteresting, symbol, tradingDate]);

  const drawing = useMemo(() => {
    if (!chart || chart.bars.length === 0) return null;
    const prices = [
      ...chart.bars.flatMap((bar) => [bar.high, bar.low]),
      ...chart.vwap.map((point) => point.value),
      ...chart.levels.map((item) => item.value),
    ];
    const rawLow = Math.min(...prices);
    const rawHigh = Math.max(...prices);
    const padding = Math.max((rawHigh - rawLow) * 0.05, rawHigh * 0.001);
    const low = rawLow - padding;
    const high = rawHigh + padding;
    const span = Math.max(high - low, 0.0001);
    const maxVolume = Math.max(1, ...chart.bars.map((bar) => bar.volume));
    const x = (index: number) => ((index + 0.5) / chart.bars.length) * WIDTH;
    const y = (price: number) => PRICE_TOP + ((high - price) / span) * PRICE_HEIGHT;
    const candleWidth = Math.max(0.6, Math.min(4, WIDTH / chart.bars.length * 0.72));
    const indexForTime = (time: number | null) => time === null ? null : chart.bars.findIndex((bar) => bar.time === time);
    const regularStart = indexForTime(chart.regularSession.firstBarTime);
    const regularEnd = indexForTime(chart.regularSession.lastBarTime);
    const markerIndex = indexForTime(chart.markerTime);
    return { low, high, maxVolume, x, y, candleWidth, regularStart, regularEnd, markerIndex };
  }, [chart]);

  if (error) return <div role="alert" className="p-4 text-xs text-signal-red">Archive chart unavailable: {error}</div>;
  if (!chart || !drawing) return <div role="status" className="p-4 text-xs text-platinum-dim">Loading archived 1-minute chart…</div>;

  const regularX = drawing.regularStart === null || drawing.regularStart < 0 ? 0 : drawing.x(drawing.regularStart) - drawing.candleWidth;
  const regularEndX = drawing.regularEnd === null || drawing.regularEnd < 0 ? 0 : drawing.x(drawing.regularEnd) + drawing.candleWidth;
  const vwapPoints = chart.vwap.map((point, index) => `${drawing.x(index)},${drawing.y(point.value)}`).join(" ");
  const labelIndexes = [...new Set([0, drawing.regularStart, Math.floor(chart.bars.length / 2), drawing.regularEnd, chart.bars.length - 1])]
    .filter((index): index is number => index !== null && index >= 0 && index < chart.bars.length);

  return (
    <div className="border-t border-obsidian-border bg-black/20" data-chart-symbol={symbol}>
      <div className="px-3 pt-3 flex flex-wrap gap-3 text-[10px] text-platinum-dim">
        <span>Local SIP archive · split-adjusted · 1-minute</span>
        <span><i className="inline-block w-3 h-2 mr-1 bg-white/5 border border-white/10" />Extended hours</span>
        <span><i className="inline-block w-3 h-2 mr-1 bg-white/10" />Regular session</span>
        <span className="text-amber">Marker {becameInteresting} ET</span>
      </div>
      <div className="overflow-x-auto px-2 pb-2">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="w-full min-w-[900px]"
          role="img"
          aria-label={`${symbol} archived one-minute candlestick chart for ${tradingDate}, with volume, VWAP, session levels, and interesting-time marker`}
        >
          <rect x="0" y="0" width={WIDTH} height={VOLUME_TOP + VOLUME_HEIGHT} fill="rgba(255,255,255,.025)" />
          {regularEndX > regularX ? <rect x={regularX} y="0" width={regularEndX - regularX} height={VOLUME_TOP + VOLUME_HEIGHT} fill="rgba(255,255,255,.045)" /> : null}
          {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
            const y = PRICE_TOP + fraction * PRICE_HEIGHT;
            const price = drawing.high - fraction * (drawing.high - drawing.low);
            return <g key={fraction}><line x1="0" y1={y} x2={WIDTH} y2={y} stroke="rgba(255,255,255,.06)" /><text x="4" y={y - 3} fill="#71808d" fontSize="10">{price.toFixed(2)}</text></g>;
          })}
          {chart.levels.map((item) => {
            const y = drawing.y(item.value);
            return <g key={item.kind}><line x1="0" y1={y} x2={WIDTH} y2={y} stroke={LEVEL_COLORS[item.kind]} strokeOpacity=".52" strokeDasharray="5 4" /><text x={WIDTH - 4} y={y - 3} textAnchor="end" fill={LEVEL_COLORS[item.kind]} fontSize="10">{item.label} {item.value.toFixed(2)}</text></g>;
          })}
          <polyline points={vwapPoints} fill="none" stroke="#c084fc" strokeWidth="1.4" strokeOpacity=".9" />
          {chart.bars.map((bar, index) => {
            const bullish = bar.close >= bar.open;
            const color = bullish ? "#45c58a" : "#e05252";
            const bodyTop = drawing.y(Math.max(bar.open, bar.close));
            const bodyHeight = Math.max(0.8, Math.abs(drawing.y(bar.open) - drawing.y(bar.close)));
            const volumeHeight = bar.volume / drawing.maxVolume * VOLUME_HEIGHT;
            return (
              <g key={bar.time}>
                <line x1={drawing.x(index)} y1={drawing.y(bar.high)} x2={drawing.x(index)} y2={drawing.y(bar.low)} stroke={color} strokeWidth="0.7" />
                <rect x={drawing.x(index) - drawing.candleWidth / 2} y={bodyTop} width={drawing.candleWidth} height={bodyHeight} fill={color} />
                <rect x={drawing.x(index) - drawing.candleWidth / 2} y={VOLUME_TOP + VOLUME_HEIGHT - volumeHeight} width={drawing.candleWidth} height={volumeHeight} fill={color} opacity=".38" />
              </g>
            );
          })}
          {drawing.markerIndex !== null && drawing.markerIndex >= 0 ? <g><line x1={drawing.x(drawing.markerIndex)} y1="0" x2={drawing.x(drawing.markerIndex)} y2={VOLUME_TOP + VOLUME_HEIGHT} stroke="#f4c95d" strokeWidth="2" /><text x={drawing.x(drawing.markerIndex) + 5} y="14" fill="#f4c95d" fontSize="11">Interesting {becameInteresting}</text></g> : null}
          <line x1="0" y1={VOLUME_TOP - 10} x2={WIDTH} y2={VOLUME_TOP - 10} stroke="rgba(255,255,255,.12)" />
          <text x="4" y={VOLUME_TOP - 14} fill="#71808d" fontSize="10">VOLUME</text>
          {labelIndexes.map((index) => <text key={index} x={drawing.x(index)} y={HEIGHT - 7} textAnchor="middle" fill="#71808d" fontSize="10">{easternLabel(chart.bars[index].time)}</text>)}
        </svg>
      </div>
    </div>
  );
}
