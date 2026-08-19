"use client";

import type {
  MarketMapReference,
  MarketMapSnapshot,
} from "@/lib/attention/marketMap";

function referenceLine(reference: MarketMapReference | null): string {
  if (!reference) return "Unavailable";
  const atr =
    reference.distanceAtr === null
      ? ""
      : ` · ${reference.distanceAtr.toFixed(2)} ATR`;
  const expected =
    reference.expectedMoveFraction === null
      ? ""
      : ` · ${reference.expectedMoveFraction.toFixed(2)} × expected move`;
  return `${reference.label} ${reference.price.toFixed(2)} · ${reference.distancePct.toFixed(2)}%${atr}${expected}`;
}

export function MarketMapPanel({ map }: { map: MarketMapSnapshot }) {
  return (
    <section aria-label={`${map.symbol} market map`}>
      <header>
        <h3>Market map</h3>
        <p>
          Price {map.price.toFixed(2)} · VWAP{" "}
          {map.vwap === null ? "unavailable" : map.vwap.toFixed(2)} · HOD{" "}
          {map.hod.toFixed(2)} · LOD {map.lod.toFixed(2)}
        </p>
      </header>

      <dl>
        <dt>Nearest upside</dt>
        <dd>{referenceLine(map.nearestUpside)}</dd>
        <dt>Next upside</dt>
        <dd>{referenceLine(map.nextUpside)}</dd>
        <dt>Nearest downside</dt>
        <dd>{referenceLine(map.nearestDownside)}</dd>
        <dt>Next downside</dt>
        <dd>{referenceLine(map.nextDownside)}</dd>
      </dl>

      <table>
        <thead>
          <tr>
            <th>Level</th>
            <th>Price</th>
            <th>Relevance</th>
            <th>Reactions</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {map.levels.map((level) => (
            <tr key={level.id}>
              <td>{level.kind}</td>
              <td>{level.price.toFixed(2)}</td>
              <td>{level.relevance.score.toFixed(0)}</td>
              <td>{level.relevance.reactionCount}</td>
              <td>
                {level.relevance.stillUnbroken ? "unbroken" : "broken"}
                {level.relevance.automaticPriority > 0
                  ? ` · automatic priority ${(
                      level.relevance.automaticPriority * 100
                    ).toFixed(0)}%`
                  : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        References describe location, not a predicted or guaranteed destination.
      </p>
    </section>
  );
}
