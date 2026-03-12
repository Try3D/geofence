export type ContainsItem = {
  osm_id: string;
  name: string | null;
};

export type NearbyItem = ContainsItem & {
  distance_m: number;
};

export type BatchResult = {
  idx: number;
  osm_id: string;
  name: string | null;
};

export type JsonBatchResult = {
  idx: number;
  matches: Array<{ osm_id: string; name: string | null }>;
};
