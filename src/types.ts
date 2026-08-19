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
  /** Meters from request origin; only set on geo searches. */
  geo_distance?: number | null;
  /** App-only favorites folder name. */
  group?: string;
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
  | 'map'
  | 'countries'
  | 'genres'
  | 'favorites'
  | 'recent'
  | 'search';

export type SortId = 'clickcount' | 'votes' | 'name' | 'bitrate' | 'clicktrend' | 'random';

export type SleepMinutes = 15 | 30 | 45 | 60 | 90;

/** Discover "Right now" period: follow clock, or a fixed bucket. */
export type TimeOfDayPeriod = 'morning' | 'day' | 'evening' | 'night';
export type TimeOfDayMode = 'auto' | TimeOfDayPeriod;
export type SurpriseMode = 'anywhere' | 'here';
export type TagPlaybackBehavior = 'keep' | 'first' | 'random';
export type PowerSaverMode = 'auto' | 'on' | 'off';

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
  /** Behavior when a Mood&Genre tag is selected: keep current station, play 1st, or play random */
  tagPlaybackBehavior: TagPlaybackBehavior;
  /** When true, 🎲 Random picks from the full API genre catalog instead of curated moods. */
  randomAllGenres: boolean;
  /** When true, the current selectedTag was selected via 🎲 Random picker */
  isRandomGenre: boolean;
  detailStation: Station | null;
  toast: string | null;
  nearMe: boolean;
  userLat: number | null;
  userLon: number | null;
  /** Right now strip: auto follows local clock, or a pinned period */
  timeOfDayMode: TimeOfDayMode;
  surpriseMode: SurpriseMode | null;
  favoriteGroupFilter: string | null;
  recentQuery: string;
  powerSaver: PowerSaverMode;
}

export interface AppPrefs {
  httpsOnly: boolean;
  tagPlaybackBehavior: TagPlaybackBehavior;
  randomAllGenres: boolean;
  isRandomGenre: boolean;
  sort: SortId;
  timeOfDayMode: TimeOfDayMode;
  selectedTag: string | null;
  selectedCountry: string | null;
  continentFilter: string | null;
  languageFilter: string | null;
  browseFilter: string;
  view: ViewId;
  favoriteGroupFilter: string | null;
  powerSaver: PowerSaverMode;
}
