type InitMessage = {
  type: "init";
  candidates: CandidateData[];
  centroids: Float64Array;
};

type RankMessage = {
  type: "rank";
  requestId: number;
};

type OutlierMessage = {
  type: "outlier";
  requestId: number;
};

type SurpriseMessage = {
  type: "surprise";
  requestId: number;
};

type GradientMessage = {
  type: "gradient";
  requestId: number;
};

type WorkerMessage =
  | InitMessage
  | RankMessage
  | OutlierMessage
  | SurpriseMessage
  | GradientMessage;

type CandidateData = {
  index: number;
  properties: Record<string, unknown>;
};

type ScoredResult = {
  index: number;
  score: number;
};

let candidates: CandidateData[] = [];
let candidateCentroids: Float64Array = new Float64Array(0);

function rankCandidates(): ScoredResult[] {
  const results: ScoredResult[] = [];
  
  for (const candidate of candidates) {
    const { properties } = candidate;
    
    const popDensity = (properties.population_density as number) ?? 0;
    const vulnerability = (properties.vulnerability_index as number) ?? 0;
    
    const score = popDensity * vulnerability;
    
    results.push({
      index: candidate.index,
      score,
    });
  }
  
  results.sort((a, b) => b.score - a.score || a.index - b.index);
  return results;
}

function computeOutlierScores(): ScoredResult[] {
  return [];
}

function computeSurpriseScores(): ScoredResult[] {
  return [];
}

function computeGradientScores(): ScoredResult[] {
  return [];
}

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  if (event.data.type === "init") {
    candidates = event.data.candidates;
    candidateCentroids = new Float64Array(event.data.centroids);
    return;
  }

  if (event.data.type === "outlier") {
    const results = computeOutlierScores();
    self.postMessage({
      type: "outlier-result",
      requestId: event.data.requestId,
      results,
    });
    return;
  }

  if (event.data.type === "surprise") {
    const results = computeSurpriseScores();
    self.postMessage({
      type: "surprise-result",
      requestId: event.data.requestId,
      results,
    });
    return;
  }

  if (event.data.type === "gradient") {
    const results = computeGradientScores();
    self.postMessage({
      type: "gradient-result",
      requestId: event.data.requestId,
      results,
    });
    return;
  }

  const results = rankCandidates();
  self.postMessage({
    type: "rank-result",
    requestId: event.data.requestId,
    results,
  });
};
