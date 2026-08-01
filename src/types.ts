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

export interface Language {
  name: string;
  iso_639?: string;
  stationcount: number;
}

export type ViewId =
  | 'discover'
  | 'countries'
  | 'genres'
  | 'favorites'
  | 'recent'
  | 'search';

export type SortId = 'clickcount' | 'votes' | 'name' | 'bitrate' | 'clicktrend' | 'random';

export type SleepMinutes = 15 | 30 | 45 | 60 | 90;

export interface AppState {
  view: ViewId;
  stations: Station[];
  countries: Country[];
  tags: Tag[];
  languages: Language[];
  favorites: Station[];
  recent: Station[];
  current: Station | null;
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
  /** Local filter for country/genre browse lists */
  browseFilter: string;
  sort: SortId;
  languageFilter: string | null;
  httpsOnly: boolean;
  detailStation: Station | null;
  toast: string | null;
  nearMe: boolean;
  userLat: number | null;
  userLon: number | null;
}

export interface AppPrefs {
  httpsOnly: boolean;
  sort: SortId;
}
