export interface Station {
  changeuuid: string;
  stationuuid: string;
  name: string;
  url: string;
  url_resolved: string;
  homepage: string;
  favicon: string;
  tags: string;
  country: string;
  countrycode: string;
  state: string;
  language: string;
  languagecodes: string;
  votes: number;
  codec: string;
  bitrate: number;
  lastcheckok: number;
  clickcount: number;
  clicktrend: number;
  geo_lat: number | null;
  geo_long: number | null;
}

export interface Country {
  name: string;
  iso_3166_1: string;
  stationcount: number;
}

export interface Tag {
  name: string;
  stationcount: number;
}

export type ViewId =
  | 'discover'
  | 'countries'
  | 'genres'
  | 'favorites'
  | 'recent'
  | 'search';

export interface AppState {
  view: ViewId;
  stations: Station[];
  countries: Country[];
  tags: Tag[];
  favorites: string[];
  recent: Station[];
  current: Station | null;
  playing: boolean;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  query: string;
  selectedCountry: string | null;
  selectedTag: string | null;
  volume: number;
  muted: boolean;
  offset: number;
  hasMore: boolean;
  continentFilter: string | null;
}
