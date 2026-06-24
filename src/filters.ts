import type { CandidateRow, FilterState, LayerType, BBox } from "./types";

export function filterByThreshold(
  rows: CandidateRow[],
  filters: FilterState
): CandidateRow[] {
  return rows.filter((row) => {
    if (filters.minPopulation !== undefined) {
      const pop = row.properties.population_density as number | undefined;
      if (pop !== undefined && pop < filters.minPopulation) {
        return false;
      }
    }
    
    if (filters.minVulnerability !== undefined) {
      const vuln = row.properties.vulnerability_index as number | undefined;
      if (vuln !== undefined && vuln < filters.minVulnerability) {
        return false;
      }
    }
    
    return true;
  });
}

export function filterByLayers(
  rows: CandidateRow[],
  enabledLayers: LayerType[]
): CandidateRow[] {
  const layerSet = new Set(enabledLayers);
  return rows.filter((row) => layerSet.has(row.layer));
}

export function filterByViewport(
  rows: CandidateRow[],
  viewport: BBox
): CandidateRow[] {
  return rows.filter((row) => {
    return (
      row.bbox.west < viewport.east &&
      row.bbox.east > viewport.west &&
      row.bbox.south < viewport.north &&
      row.bbox.north > viewport.south
    );
  });
}

export function getEnabledLayers(visibility: Record<LayerType, boolean>): LayerType[] {
  return (Object.keys(visibility) as LayerType[]).filter(
    (layer) => visibility[layer]
  );
}
