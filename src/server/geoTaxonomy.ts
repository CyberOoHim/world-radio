export interface CountryGeoInfo {
  name: string;
  continent: string;
  subRegion: string;
}

export const COUNTRY_GEO_INFO: Record<string, CountryGeoInfo> = {
  // Africa — North Africa
  DZ: { name: 'Algeria', continent: 'Africa', subRegion: 'North Africa' },
  EG: { name: 'Egypt', continent: 'Africa', subRegion: 'North Africa' },
  LY: { name: 'Libya', continent: 'Africa', subRegion: 'North Africa' },
  MA: { name: 'Morocco', continent: 'Africa', subRegion: 'North Africa' },
  SD: { name: 'Sudan', continent: 'Africa', subRegion: 'North Africa' },
  TN: { name: 'Tunisia', continent: 'Africa', subRegion: 'North Africa' },
  MR: { name: 'Mauritania', continent: 'Africa', subRegion: 'North Africa' },

  // Africa — East Africa
  BI: { name: 'Burundi', continent: 'Africa', subRegion: 'East Africa' },
  DJ: { name: 'Djibouti', continent: 'Africa', subRegion: 'East Africa' },
  ER: { name: 'Eritrea', continent: 'Africa', subRegion: 'East Africa' },
  ET: { name: 'Ethiopia', continent: 'Africa', subRegion: 'East Africa' },
  KE: { name: 'Kenya', continent: 'Africa', subRegion: 'East Africa' },
  KM: { name: 'Comoros', continent: 'Africa', subRegion: 'East Africa' },
  MG: { name: 'Madagascar', continent: 'Africa', subRegion: 'East Africa' },
  MU: { name: 'Mauritius', continent: 'Africa', subRegion: 'East Africa' },
  MW: { name: 'Malawi', continent: 'Africa', subRegion: 'East Africa' },
  MZ: { name: 'Mozambique', continent: 'Africa', subRegion: 'East Africa' },
  RW: { name: 'Rwanda', continent: 'Africa', subRegion: 'East Africa' },
  SC: { name: 'Seychelles', continent: 'Africa', subRegion: 'East Africa' },
  SO: { name: 'Somalia', continent: 'Africa', subRegion: 'East Africa' },
  SS: { name: 'South Sudan', continent: 'Africa', subRegion: 'East Africa' },
  TZ: { name: 'Tanzania', continent: 'Africa', subRegion: 'East Africa' },
  UG: { name: 'Uganda', continent: 'Africa', subRegion: 'East Africa' },
  ZM: { name: 'Zambia', continent: 'Africa', subRegion: 'East Africa' },
  ZW: { name: 'Zimbabwe', continent: 'Africa', subRegion: 'East Africa' },

  // Africa — West Africa
  BF: { name: 'Burkina Faso', continent: 'Africa', subRegion: 'West Africa' },
  BJ: { name: 'Benin', continent: 'Africa', subRegion: 'West Africa' },
  CI: { name: "Cote d'Ivoire", continent: 'Africa', subRegion: 'West Africa' },
  CV: { name: 'Cape Verde', continent: 'Africa', subRegion: 'West Africa' },
  GH: { name: 'Ghana', continent: 'Africa', subRegion: 'West Africa' },
  GM: { name: 'Gambia', continent: 'Africa', subRegion: 'West Africa' },
  GN: { name: 'Guinea', continent: 'Africa', subRegion: 'West Africa' },
  GW: { name: 'Guinea-Bissau', continent: 'Africa', subRegion: 'West Africa' },
  LR: { name: 'Liberia', continent: 'Africa', subRegion: 'West Africa' },
  ML: { name: 'Mali', continent: 'Africa', subRegion: 'West Africa' },
  NE: { name: 'Niger', continent: 'Africa', subRegion: 'West Africa' },
  NG: { name: 'Nigeria', continent: 'Africa', subRegion: 'West Africa' },
  SL: { name: 'Sierra Leone', continent: 'Africa', subRegion: 'West Africa' },
  SN: { name: 'Senegal', continent: 'Africa', subRegion: 'West Africa' },
  TG: { name: 'Togo', continent: 'Africa', subRegion: 'West Africa' },

  // Africa — Central Africa
  AO: { name: 'Angola', continent: 'Africa', subRegion: 'Central Africa' },
  CD: { name: 'DR Congo', continent: 'Africa', subRegion: 'Central Africa' },
  CF: { name: 'Central African Republic', continent: 'Africa', subRegion: 'Central Africa' },
  CG: { name: 'Republic of the Congo', continent: 'Africa', subRegion: 'Central Africa' },
  CM: { name: 'Cameroon', continent: 'Africa', subRegion: 'Central Africa' },
  GA: { name: 'Gabon', continent: 'Africa', subRegion: 'Central Africa' },
  GQ: { name: 'Equatorial Guinea', continent: 'Africa', subRegion: 'Central Africa' },
  ST: { name: 'Sao Tome and Principe', continent: 'Africa', subRegion: 'Central Africa' },
  TD: { name: 'Chad', continent: 'Africa', subRegion: 'Central Africa' },

  // Africa — Southern Africa
  BW: { name: 'Botswana', continent: 'Africa', subRegion: 'Southern Africa' },
  LS: { name: 'Lesotho', continent: 'Africa', subRegion: 'Southern Africa' },
  NA: { name: 'Namibia', continent: 'Africa', subRegion: 'Southern Africa' },
  SZ: { name: 'Eswatini', continent: 'Africa', subRegion: 'Southern Africa' },
  ZA: { name: 'South Africa', continent: 'Africa', subRegion: 'Southern Africa' },

  // South America
  AR: { name: 'Argentina', continent: 'South America', subRegion: 'Southern Cone' },
  BO: { name: 'Bolivia', continent: 'South America', subRegion: 'Andes & Amazonia' },
  BR: { name: 'Brazil', continent: 'South America', subRegion: 'Amazonia & Brazil' },
  CL: { name: 'Chile', continent: 'South America', subRegion: 'Southern Cone & Andes' },
  CO: { name: 'Colombia', continent: 'South America', subRegion: 'Andes & Amazonia' },
  EC: { name: 'Ecuador', continent: 'South America', subRegion: 'Andes & Amazonia' },
  GY: { name: 'Guyana', continent: 'South America', subRegion: 'Amazonia & Guianas' },
  PE: { name: 'Peru', continent: 'South America', subRegion: 'Andes & Amazonia' },
  PY: { name: 'Paraguay', continent: 'South America', subRegion: 'Southern Cone' },
  SR: { name: 'Suriname', continent: 'South America', subRegion: 'Amazonia & Guianas' },
  UY: { name: 'Uruguay', continent: 'South America', subRegion: 'Southern Cone' },
  VE: { name: 'Venezuela', continent: 'South America', subRegion: 'Northern South America & Amazonia' },

  // North America, Central America & Caribbean
  AG: { name: 'Antigua and Barbuda', continent: 'North America', subRegion: 'Caribbean' },
  BB: { name: 'Barbados', continent: 'North America', subRegion: 'Caribbean' },
  BS: { name: 'Bahamas', continent: 'North America', subRegion: 'Caribbean' },
  BZ: { name: 'Belize', continent: 'North America', subRegion: 'Central America' },
  CA: { name: 'Canada', continent: 'North America', subRegion: 'North America' },
  CR: { name: 'Costa Rica', continent: 'North America', subRegion: 'Central America' },
  CU: { name: 'Cuba', continent: 'North America', subRegion: 'Caribbean' },
  DM: { name: 'Dominica', continent: 'North America', subRegion: 'Caribbean' },
  DO: { name: 'Dominican Republic', continent: 'North America', subRegion: 'Caribbean' },
  GD: { name: 'Grenada', continent: 'North America', subRegion: 'Caribbean' },
  GT: { name: 'Guatemala', continent: 'North America', subRegion: 'Central America' },
  HN: { name: 'Honduras', continent: 'North America', subRegion: 'Central America' },
  HT: { name: 'Haiti', continent: 'North America', subRegion: 'Caribbean' },
  JM: { name: 'Jamaica', continent: 'North America', subRegion: 'Caribbean' },
  KN: { name: 'Saint Kitts and Nevis', continent: 'North America', subRegion: 'Caribbean' },
  LC: { name: 'Saint Lucia', continent: 'North America', subRegion: 'Caribbean' },
  MX: { name: 'Mexico', continent: 'North America', subRegion: 'North & Central America' },
  NI: { name: 'Nicaragua', continent: 'North America', subRegion: 'Central America' },
  PA: { name: 'Panama', continent: 'North America', subRegion: 'Central America' },
  PR: { name: 'Puerto Rico', continent: 'North America', subRegion: 'Caribbean' },
  SV: { name: 'El Salvador', continent: 'North America', subRegion: 'Central America' },
  TT: { name: 'Trinidad and Tobago', continent: 'North America', subRegion: 'Caribbean' },
  US: { name: 'United States', continent: 'North America', subRegion: 'North America' },
  VC: { name: 'Saint Vincent', continent: 'North America', subRegion: 'Caribbean' },

  // Europe
  AD: { name: 'Andorra', continent: 'Europe', subRegion: 'Western Europe' },
  AL: { name: 'Albania', continent: 'Europe', subRegion: 'Balkans' },
  AT: { name: 'Austria', continent: 'Europe', subRegion: 'Central Europe' },
  BA: { name: 'Bosnia and Herzegovina', continent: 'Europe', subRegion: 'Balkans' },
  BE: { name: 'Belgium', continent: 'Europe', subRegion: 'Western Europe' },
  BG: { name: 'Bulgaria', continent: 'Europe', subRegion: 'Balkans' },
  BY: { name: 'Belarus', continent: 'Europe', subRegion: 'Eastern Europe' },
  CH: { name: 'Switzerland', continent: 'Europe', subRegion: 'Central Europe' },
  CZ: { name: 'Czechia', continent: 'Europe', subRegion: 'Central Europe' },
  DE: { name: 'Germany', continent: 'Europe', subRegion: 'Central Europe' },
  DK: { name: 'Denmark', continent: 'Europe', subRegion: 'Nordic' },
  EE: { name: 'Estonia', continent: 'Europe', subRegion: 'Baltic' },
  ES: { name: 'Spain', continent: 'Europe', subRegion: 'Iberia & Mediterranean' },
  FI: { name: 'Finland', continent: 'Europe', subRegion: 'Nordic' },
  FR: { name: 'France', continent: 'Europe', subRegion: 'Western Europe' },
  GB: { name: 'United Kingdom', continent: 'Europe', subRegion: 'British Isles' },
  GR: { name: 'Greece', continent: 'Europe', subRegion: 'Mediterranean & Balkans' },
  HR: { name: 'Croatia', continent: 'Europe', subRegion: 'Balkans & Mediterranean' },
  HU: { name: 'Hungary', continent: 'Europe', subRegion: 'Central Europe' },
  IE: { name: 'Ireland', continent: 'Europe', subRegion: 'British Isles' },
  IS: { name: 'Iceland', continent: 'Europe', subRegion: 'Nordic' },
  IT: { name: 'Italy', continent: 'Europe', subRegion: 'Mediterranean' },
  LI: { name: 'Liechtenstein', continent: 'Europe', subRegion: 'Central Europe' },
  LT: { name: 'Lithuania', continent: 'Europe', subRegion: 'Baltic' },
  LU: { name: 'Luxembourg', continent: 'Europe', subRegion: 'Western Europe' },
  LV: { name: 'Latvia', continent: 'Europe', subRegion: 'Baltic' },
  MC: { name: 'Monaco', continent: 'Europe', subRegion: 'Western Europe' },
  MD: { name: 'Moldova', continent: 'Europe', subRegion: 'Eastern Europe' },
  ME: { name: 'Montenegro', continent: 'Europe', subRegion: 'Balkans' },
  MK: { name: 'North Macedonia', continent: 'Europe', subRegion: 'Balkans' },
  MT: { name: 'Malta', continent: 'Europe', subRegion: 'Mediterranean' },
  NL: { name: 'Netherlands', continent: 'Europe', subRegion: 'Western Europe' },
  NO: { name: 'Norway', continent: 'Europe', subRegion: 'Nordic' },
  PL: { name: 'Poland', continent: 'Europe', subRegion: 'Central Europe' },
  PT: { name: 'Portugal', continent: 'Europe', subRegion: 'Iberia' },
  RO: { name: 'Romania', continent: 'Europe', subRegion: 'Eastern Europe & Balkans' },
  RS: { name: 'Serbia', continent: 'Europe', subRegion: 'Balkans' },
  RU: { name: 'Russia', continent: 'Europe', subRegion: 'Eastern Europe & Eurasia' },
  SE: { name: 'Sweden', continent: 'Europe', subRegion: 'Nordic' },
  SI: { name: 'Slovenia', continent: 'Europe', subRegion: 'Central Europe & Balkans' },
  SK: { name: 'Slovakia', continent: 'Europe', subRegion: 'Central Europe' },
  SM: { name: 'San Marino', continent: 'Europe', subRegion: 'Mediterranean' },
  UA: { name: 'Ukraine', continent: 'Europe', subRegion: 'Eastern Europe' },
  VA: { name: 'Vatican City', continent: 'Europe', subRegion: 'Mediterranean' },
  XK: { name: 'Kosovo', continent: 'Europe', subRegion: 'Balkans' },

  // Asia & Middle East
  AE: { name: 'United Arab Emirates', continent: 'Asia', subRegion: 'Middle East' },
  AF: { name: 'Afghanistan', continent: 'Asia', subRegion: 'Central & South Asia' },
  AM: { name: 'Armenia', continent: 'Asia', subRegion: 'Caucasus' },
  AZ: { name: 'Azerbaijan', continent: 'Asia', subRegion: 'Caucasus' },
  BD: { name: 'Bangladesh', continent: 'Asia', subRegion: 'South Asia' },
  BH: { name: 'Bahrain', continent: 'Asia', subRegion: 'Middle East' },
  BN: { name: 'Brunei', continent: 'Asia', subRegion: 'Southeast Asia' },
  BT: { name: 'Bhutan', continent: 'Asia', subRegion: 'South Asia & Himalayas' },
  CN: { name: 'China', continent: 'Asia', subRegion: 'East Asia' },
  CY: { name: 'Cyprus', continent: 'Asia', subRegion: 'Middle East & Mediterranean' },
  GE: { name: 'Georgia', continent: 'Asia', subRegion: 'Caucasus' },
  HK: { name: 'Hong Kong', continent: 'Asia', subRegion: 'East Asia' },
  ID: { name: 'Indonesia', continent: 'Asia', subRegion: 'Southeast Asia' },
  IL: { name: 'Israel', continent: 'Asia', subRegion: 'Middle East' },
  IN: { name: 'India', continent: 'Asia', subRegion: 'South Asia' },
  IQ: { name: 'Iraq', continent: 'Asia', subRegion: 'Middle East' },
  IR: { name: 'Iran', continent: 'Asia', subRegion: 'Middle East' },
  JO: { name: 'Jordan', continent: 'Asia', subRegion: 'Middle East' },
  JP: { name: 'Japan', continent: 'Asia', subRegion: 'East Asia' },
  KG: { name: 'Kyrgyzstan', continent: 'Asia', subRegion: 'Central Asia' },
  KH: { name: 'Cambodia', continent: 'Asia', subRegion: 'Southeast Asia' },
  KP: { name: 'North Korea', continent: 'Asia', subRegion: 'East Asia' },
  KR: { name: 'South Korea', continent: 'Asia', subRegion: 'East Asia' },
  KW: { name: 'Kuwait', continent: 'Asia', subRegion: 'Middle East' },
  KZ: { name: 'Kazakhstan', continent: 'Asia', subRegion: 'Central Asia' },
  LA: { name: 'Laos', continent: 'Asia', subRegion: 'Southeast Asia' },
  LB: { name: 'Lebanon', continent: 'Asia', subRegion: 'Middle East' },
  LK: { name: 'Sri Lanka', continent: 'Asia', subRegion: 'South Asia' },
  MM: { name: 'Myanmar', continent: 'Asia', subRegion: 'Southeast Asia' },
  MN: { name: 'Mongolia', continent: 'Asia', subRegion: 'East & Central Asia' },
  MO: { name: 'Macao', continent: 'Asia', subRegion: 'East Asia' },
  MV: { name: 'Maldives', continent: 'Asia', subRegion: 'South Asia' },
  MY: { name: 'Malaysia', continent: 'Asia', subRegion: 'Southeast Asia' },
  NP: { name: 'Nepal', continent: 'Asia', subRegion: 'South Asia & Himalayas' },
  OM: { name: 'Oman', continent: 'Asia', subRegion: 'Middle East' },
  PH: { name: 'Philippines', continent: 'Asia', subRegion: 'Southeast Asia' },
  PK: { name: 'Pakistan', continent: 'Asia', subRegion: 'South Asia' },
  PS: { name: 'Palestine', continent: 'Asia', subRegion: 'Middle East' },
  QA: { name: 'Qatar', continent: 'Asia', subRegion: 'Middle East' },
  SA: { name: 'Saudi Arabia', continent: 'Asia', subRegion: 'Middle East' },
  SG: { name: 'Singapore', continent: 'Asia', subRegion: 'Southeast Asia' },
  SY: { name: 'Syria', continent: 'Asia', subRegion: 'Middle East' },
  TH: { name: 'Thailand', continent: 'Asia', subRegion: 'Southeast Asia' },
  TJ: { name: 'Tajikistan', continent: 'Asia', subRegion: 'Central Asia' },
  TL: { name: 'Timor-Leste', continent: 'Asia', subRegion: 'Southeast Asia' },
  TM: { name: 'Turkmenistan', continent: 'Asia', subRegion: 'Central Asia' },
  TR: { name: 'Turkey', continent: 'Asia', subRegion: 'Middle East & Mediterranean' },
  TW: { name: 'Taiwan', continent: 'Asia', subRegion: 'East Asia' },
  UZ: { name: 'Uzbekistan', continent: 'Asia', subRegion: 'Central Asia' },
  VN: { name: 'Vietnam', continent: 'Asia', subRegion: 'Southeast Asia' },
  YE: { name: 'Yemen', continent: 'Asia', subRegion: 'Middle East' },

  // Oceania
  AU: { name: 'Australia', continent: 'Oceania', subRegion: 'Oceania' },
  FJ: { name: 'Fiji', continent: 'Oceania', subRegion: 'Pacific Islands' },
  FM: { name: 'Micronesia', continent: 'Oceania', subRegion: 'Pacific Islands' },
  KI: { name: 'Kiribati', continent: 'Oceania', subRegion: 'Pacific Islands' },
  MH: { name: 'Marshall Islands', continent: 'Oceania', subRegion: 'Pacific Islands' },
  NR: { name: 'Nauru', continent: 'Oceania', subRegion: 'Pacific Islands' },
  NZ: { name: 'New Zealand', continent: 'Oceania', subRegion: 'Oceania' },
  PG: { name: 'Papua New Guinea', continent: 'Oceania', subRegion: 'Pacific Islands' },
  PW: { name: 'Palau', continent: 'Oceania', subRegion: 'Pacific Islands' },
  SB: { name: 'Solomon Islands', continent: 'Oceania', subRegion: 'Pacific Islands' },
  TO: { name: 'Tonga', continent: 'Oceania', subRegion: 'Pacific Islands' },
  TV: { name: 'Tuvalu', continent: 'Oceania', subRegion: 'Pacific Islands' },
  VU: { name: 'Vanuatu', continent: 'Oceania', subRegion: 'Pacific Islands' },
  WS: { name: 'Samoa', continent: 'Oceania', subRegion: 'Pacific Islands' },
};

export function getStationGeoLabels(countryCode: string): {
  continent: string;
  subRegion: string;
  countryName: string;
} | null {
  const code = (countryCode || '').trim().toUpperCase();
  if (!code) return null;
  const info = COUNTRY_GEO_INFO[code];
  if (!info) return null;
  return {
    continent: info.continent,
    subRegion: info.subRegion,
    countryName: info.name,
  };
}

interface GazetteerRule {
  patterns: RegExp[];
  regionLabel: string;
  countryCodes: string[];
  regionalTags: string[];
}

const GAZETTEER_RULES: GazetteerRule[] = [
  {
    patterns: [/\b(safari|serengeti|savanna|savannah|kruger|okavango|kilimanjaro|masai|maasai|ngorongoro)\b/i],
    regionLabel: 'East & Southern Africa',
    countryCodes: ['KE', 'TZ', 'ZA', 'BW', 'NA', 'UG', 'ZW', 'ZM', 'RW', 'MZ', 'MW'],
    regionalTags: ['african', 'african music', 'afrobeat', 'world music', 'folk'],
  },
  {
    patterns: [/\b(east africa|east african|horn of africa|swahili)\b/i],
    regionLabel: 'East Africa',
    countryCodes: ['KE', 'TZ', 'UG', 'ET', 'RW', 'BI', 'SO', 'MG', 'MU', 'MW', 'MZ'],
    regionalTags: ['african', 'african music', 'ethio-jazz', 'world music'],
  },
  {
    patterns: [/\b(west africa|west african|afrobeat|afrobeats|highlife|mbalax|griot)\b/i],
    regionLabel: 'West Africa',
    countryCodes: ['NG', 'GH', 'SN', 'CI', 'ML', 'BF', 'BJ', 'TG', 'CM', 'GN', 'CV'],
    regionalTags: ['afrobeat', 'afrobeats', 'african', 'african music', 'highlife'],
  },
  {
    patterns: [/\b(north africa|north african|maghreb|sahara|saharan|nile|atlas mountains)\b/i],
    regionLabel: 'North Africa',
    countryCodes: ['MA', 'EG', 'TN', 'DZ', 'LY', 'SD', 'MR'],
    regionalTags: ['arabic', 'african', 'world music', 'folk'],
  },
  {
    patterns: [/\b(southern africa|south africa)\b/i],
    regionLabel: 'Southern Africa',
    countryCodes: ['ZA', 'BW', 'NA', 'ZW', 'ZM', 'MZ', 'MW', 'LS', 'SZ'],
    regionalTags: ['african', 'jazz', 'afrobeat', 'kwaito', 'amapiano'],
  },
  {
    patterns: [/\b(central africa|congo basin|congo)\b/i],
    regionLabel: 'Central Africa',
    countryCodes: ['CD', 'CG', 'CM', 'GA', 'AO', 'CF', 'TD'],
    regionalTags: ['african', 'african music', 'soukous', 'rumba'],
  },
  {
    patterns: [/\b(africa|african|afro)\b/i],
    regionLabel: 'Africa',
    countryCodes: ['KE', 'ZA', 'NG', 'GH', 'TZ', 'ET', 'SN', 'MA', 'EG', 'UG', 'CI', 'CM', 'BW', 'NA', 'TN', 'DZ', 'RW', 'CD'],
    regionalTags: ['african', 'african music', 'afrobeat', 'afrobeats', 'world music'],
  },
  {
    patterns: [/\b(amazon|amazonia|amazonian|rain\s?forest|rainy\s+forest|selva|orinoco)\b/i],
    regionLabel: 'Amazonia & South America',
    countryCodes: ['BR', 'PE', 'CO', 'EC', 'BO', 'VE', 'GY', 'SR'],
    regionalTags: ['mpb', 'bossa nova', 'samba', 'latin', 'cumbia', 'folk', 'world music'],
  },
  {
    patterns: [/\b(andes|andean|altiplano|machu picchu|titicaca)\b/i],
    regionLabel: 'Andes',
    countryCodes: ['PE', 'BO', 'EC', 'CO', 'CL', 'AR'],
    regionalTags: ['andina', 'folk', 'latin', 'cumbia', 'world music'],
  },
  {
    patterns: [/\b(patagonia|pampas|rio de la plata|tango|gaucho)\b/i],
    regionLabel: 'Southern Cone',
    countryCodes: ['AR', 'CL', 'UY', 'PY'],
    regionalTags: ['tango', 'folklore', 'latin', 'rock nacional'],
  },
  {
    patterns: [/\b(south america|south american|latin america|latinoamerica)\b/i],
    regionLabel: 'South America',
    countryCodes: ['BR', 'AR', 'CO', 'PE', 'CL', 'EC', 'BO', 'VE', 'UY', 'PY'],
    regionalTags: ['latin', 'mpb', 'bossa nova', 'cumbia', 'tango', 'salsa', 'folk'],
  },
  {
    patterns: [/\b(caribbean|west indies|reggae|dub|calypso|soca|salsa|son cubano)\b/i],
    regionLabel: 'Caribbean',
    countryCodes: ['JM', 'CU', 'PR', 'DO', 'TT', 'BB', 'BS', 'HT', 'LC', 'GD'],
    regionalTags: ['reggae', 'dub', 'salsa', 'latin', 'caribbean', 'calypso'],
  },
  {
    patterns: [/\b(central america|mesoamerica)\b/i],
    regionLabel: 'Central America',
    countryCodes: ['CR', 'PA', 'GT', 'NI', 'HN', 'SV', 'BZ'],
    regionalTags: ['latin', 'cumbia', 'salsa', 'folk'],
  },
  {
    patterns: [/\b(nordic|scandinavia|scandinavian|fjord|lapland|arctic)\b/i],
    regionLabel: 'Nordic',
    countryCodes: ['NO', 'SE', 'FI', 'DK', 'IS'],
    regionalTags: ['folk', 'ambient', 'indie', 'nordic', 'classical'],
  },
  {
    patterns: [/\b(balkan|balkans|adriatic)\b/i],
    regionLabel: 'Balkans',
    countryCodes: ['RS', 'HR', 'BA', 'BG', 'AL', 'MK', 'ME', 'RO', 'GR', 'SI'],
    regionalTags: ['folk', 'balkan', 'world music', 'pop'],
  },
  {
    patterns: [/\b(mediterranean|aegean|levant|iberia|iberian)\b/i],
    regionLabel: 'Mediterranean',
    countryCodes: ['ES', 'PT', 'IT', 'GR', 'TR', 'FR', 'MA', 'TN', 'HR', 'LB', 'CY'],
    regionalTags: ['fado', 'flamenco', 'mediterranean', 'world music', 'acoustic'],
  },
  {
    patterns: [/\b(middle east|arabia|arabian|gulf|levant|persian|persia)\b/i],
    regionLabel: 'Middle East',
    countryCodes: ['AE', 'LB', 'JO', 'EG', 'SA', 'TR', 'QA', 'OM', 'KW', 'BH', 'IR', 'IQ', 'IL'],
    regionalTags: ['arabic', 'oriental', 'world music', 'traditional'],
  },
  {
    patterns: [/\b(southeast asia|indochina|asean|mekong|bali|java)\b/i],
    regionLabel: 'Southeast Asia',
    countryCodes: ['TH', 'VN', 'ID', 'MY', 'PH', 'SG', 'KH', 'LA', 'MM'],
    regionalTags: ['asian', 'pop', 'world music', 'traditional', 'gamelan'],
  },
  {
    patterns: [/\b(south asia|indian subcontinent|himalaya|himalayas|bollywood|raga|sitar)\b/i],
    regionLabel: 'South Asia',
    countryCodes: ['IN', 'PK', 'NP', 'BD', 'LK', 'BT'],
    regionalTags: ['bollywood', 'indian', 'hindi', 'classical', 'devotional'],
  },
  {
    patterns: [/\b(east asia|east asian)\b/i],
    regionLabel: 'East Asia',
    countryCodes: ['JP', 'KR', 'TW', 'HK', 'CN', 'MN'],
    regionalTags: ['j-pop', 'k-pop', 'anime', 'jazz', 'city pop', 'c-pop'],
  },
  {
    patterns: [/\b(oceania|outback|australasia|polynesia|pacific islands)\b/i],
    regionLabel: 'Oceania',
    countryCodes: ['AU', 'NZ', 'FJ', 'PG', 'WS', 'TO', 'VU'],
    regionalTags: ['indie', 'rock', 'world music', 'folk', 'pacific'],
  },
  // High-signal countries, cities, and demonyms
  { patterns: [/\b(kenya|kenyan|nairobi|mombasa)\b/i], regionLabel: 'Kenya', countryCodes: ['KE'], regionalTags: ['african', 'afrobeat', 'gospel', 'news'] },
  { patterns: [/\b(tanzania|tanzanian|dar es salaam|zanzibar)\b/i], regionLabel: 'Tanzania', countryCodes: ['TZ'], regionalTags: ['african', 'bongo flava', 'swahili'] },
  { patterns: [/\b(ethiopia|ethiopian|addis ababa|ethio-jazz|ethio)\b/i], regionLabel: 'Ethiopia', countryCodes: ['ET'], regionalTags: ['ethio-jazz', 'african', 'world music'] },
  { patterns: [/\b(nigeria|nigerian|lagos|abuja)\b/i], regionLabel: 'Nigeria', countryCodes: ['NG'], regionalTags: ['afrobeat', 'afrobeats', 'african', 'gospel'] },
  { patterns: [/\b(ghana|ghanaian|accra)\b/i], regionLabel: 'Ghana', countryCodes: ['GH'], regionalTags: ['highlife', 'afrobeats', 'african'] },
  { patterns: [/\b(senegal|senegalese|dakar)\b/i], regionLabel: 'Senegal', countryCodes: ['SN'], regionalTags: ['african', 'mbalax', 'world music'] },
  { patterns: [/\b(morocco|moroccan|marrakech|casablanca|rabat|tangier)\b/i], regionLabel: 'Morocco', countryCodes: ['MA'], regionalTags: ['arabic', 'african', 'chaabi', 'gnawa'] },
  { patterns: [/\b(egypt|egyptian|cairo|alexandria)\b/i], regionLabel: 'Egypt', countryCodes: ['EG'], regionalTags: ['arabic', 'oriental', 'egyptian'] },
  { patterns: [/\b(uganda|ugandan|kampala)\b/i], regionLabel: 'Uganda', countryCodes: ['UG'], regionalTags: ['african', 'afrobeat'] },
  { patterns: [/\b(south african|johannesburg|cape town|durban|soweto|amapiano)\b/i], regionLabel: 'South Africa', countryCodes: ['ZA'], regionalTags: ['african', 'jazz', 'amapiano', 'house'] },
  { patterns: [/\b(brazil|brazilian|brasil|rio|sao paulo|manaus|bahia|bossa|mpb|samba)\b/i], regionLabel: 'Brazil', countryCodes: ['BR'], regionalTags: ['mpb', 'bossa nova', 'samba', 'sertanejo', 'latin'] },
  { patterns: [/\b(peru|peruvian|lima|cusco|iquitos)\b/i], regionLabel: 'Peru', countryCodes: ['PE'], regionalTags: ['cumbia', 'andina', 'latin', 'folk'] },
  { patterns: [/\b(colombia|colombian|bogota|medellin|cartagena|leticia)\b/i], regionLabel: 'Colombia', countryCodes: ['CO'], regionalTags: ['salsa', 'cumbia', 'vallenato', 'latin'] },
  { patterns: [/\b(ecuador|ecuadorian|quito|guayaquil|galapagos)\b/i], regionLabel: 'Ecuador', countryCodes: ['EC'], regionalTags: ['latin', 'cumbia', 'folk'] },
  { patterns: [/\b(bolivia|bolivian|la paz|santa cruz)\b/i], regionLabel: 'Bolivia', countryCodes: ['BO'], regionalTags: ['latin', 'folk', 'andina'] },
  { patterns: [/\b(argentina|argentine|buenos aires|cordoba|mendoza)\b/i], regionLabel: 'Argentina', countryCodes: ['AR'], regionalTags: ['tango', 'folklore', 'rock nacional', 'latin'] },
  { patterns: [/\b(chile|chilean|santiago|valparaiso|atacama)\b/i], regionLabel: 'Chile', countryCodes: ['CL'], regionalTags: ['latin', 'folk', 'rock'] },
  { patterns: [/\b(mexico|mexican|oaxaca|mexico city|cdmx|guadalajara)\b/i], regionLabel: 'Mexico', countryCodes: ['MX'], regionalTags: ['mariachi', 'ranchera', 'latin', 'cumbia'] },
  { patterns: [/\b(cuba|cuban|havana|habana)\b/i], regionLabel: 'Cuba', countryCodes: ['CU'], regionalTags: ['salsa', 'son', 'latin', 'jazz'] },
  { patterns: [/\b(jamaica|jamaican|kingston)\b/i], regionLabel: 'Jamaica', countryCodes: ['JM'], regionalTags: ['reggae', 'dub', 'dancehall'] },
  { patterns: [/\b(japan|japanese|tokyo|kyoto|osaka|shibuya|okinawa)\b/i], regionLabel: 'Japan', countryCodes: ['JP'], regionalTags: ['jazz', 'city pop', 'j-pop', 'anime', 'ambient'] },
  { patterns: [/\b(korea|korean|seoul|busan)\b/i], regionLabel: 'South Korea', countryCodes: ['KR'], regionalTags: ['k-pop', 'indie', 'jazz'] },
  { patterns: [/\b(india|indian|mumbai|delhi|kolkata|chennai|goa)\b/i], regionLabel: 'India', countryCodes: ['IN'], regionalTags: ['bollywood', 'hindi', 'indian', 'classical'] },
  { patterns: [/\b(france|french|paris|parisian|lyon|marseille)\b/i], regionLabel: 'France', countryCodes: ['FR'], regionalTags: ['chanson', 'french', 'jazz', 'electronic'] },
  { patterns: [/\b(portugal|portuguese|lisbon|lisboa|porto|fado)\b/i], regionLabel: 'Portugal', countryCodes: ['PT'], regionalTags: ['fado', 'portuguese', 'acoustic', 'world music'] },
  { patterns: [/\b(spain|spanish|madrid|barcelona|seville|andalusia|flamenco)\b/i], regionLabel: 'Spain', countryCodes: ['ES'], regionalTags: ['flamenco', 'spanish', 'latin', 'indie'] },
  { patterns: [/\b(italy|italian|rome|milan|naples|sicily|venice)\b/i], regionLabel: 'Italy', countryCodes: ['IT'], regionalTags: ['italian', 'opera', 'classical', 'jazz'] },
  { patterns: [/\b(germany|german|berlin|munich|hamburg)\b/i], regionLabel: 'Germany', countryCodes: ['DE'], regionalTags: ['electronic', 'techno', 'ambient', 'classical'] },
  { patterns: [/\b(uk|britain|british|england|english|london|manchester|scotland|scottish|edinburgh)\b/i], regionLabel: 'United Kingdom', countryCodes: ['GB'], regionalTags: ['indie', 'rock', 'electronic', 'bbc', 'jazz'] },
  { patterns: [/\b(ireland|irish|dublin|galway|celtic)\b/i], regionLabel: 'Ireland', countryCodes: ['IE'], regionalTags: ['celtic', 'irish', 'folk'] },
  { patterns: [/\b(turkey|turkish|istanbul|ankara)\b/i], regionLabel: 'Turkey', countryCodes: ['TR'], regionalTags: ['turkish', 'oriental', 'folk', 'pop'] },
  { patterns: [/\b(greece|greek|athens|thessaloniki|crete)\b/i], regionLabel: 'Greece', countryCodes: ['GR'], regionalTags: ['greek', 'laiko', 'rebetiko', 'folk'] },
  { patterns: [/\b(iceland|icelandic|reykjavik)\b/i], regionLabel: 'Iceland', countryCodes: ['IS'], regionalTags: ['ambient', 'indie', 'folk'] },
  { patterns: [/\b(norway|norwegian|oslo|bergen|tromso)\b/i], regionLabel: 'Norway', countryCodes: ['NO'], regionalTags: ['folk', 'jazz', 'ambient', 'indie'] },
  { patterns: [/\b(sweden|swedish|stockholm|gothenburg)\b/i], regionLabel: 'Sweden', countryCodes: ['SE'], regionalTags: ['pop', 'indie', 'folk', 'jazz'] },
  { patterns: [/\b(finland|finnish|helsinki)\b/i], regionLabel: 'Finland', countryCodes: ['FI'], regionalTags: ['folk', 'metal', 'ambient', 'classical'] },
  { patterns: [/\b(usa|united states|american|new york|nyc|chicago|new orleans|nashville|los angeles|california|texas|miami)\b/i], regionLabel: 'United States', countryCodes: ['US'], regionalTags: ['jazz', 'blues', 'country', 'soul', 'indie'] },
  { patterns: [/\b(canada|canadian|montreal|toronto|vancouver)\b/i], regionLabel: 'Canada', countryCodes: ['CA'], regionalTags: ['indie', 'folk', 'jazz', 'french'] },
  { patterns: [/\b(australia|australian|sydney|melbourne)\b/i], regionLabel: 'Australia', countryCodes: ['AU'], regionalTags: ['indie', 'rock', 'chillout'] },
  { patterns: [/\b(new zealand|auckland|wellington)\b/i], regionLabel: 'New Zealand', countryCodes: ['NZ'], regionalTags: ['indie', 'folk', 'electronic'] },
];

export interface GeoIntentResolution {
  countryCodes: string[];
  regionLabels: string[];
  regionalTags: string[];
  hasGeoIntent: boolean;
}

/** Deterministic gazetteer match extracting target countries, regions, and authentic local tags. */
export function resolveGeoIntentFromText(text: string): GeoIntentResolution {
  const cleaned = (text || '').trim();
  if (!cleaned) {
    return { countryCodes: [], regionLabels: [], regionalTags: [], hasGeoIntent: false };
  }

  const codeSet = new Set<string>();
  const regionSet = new Set<string>();
  const tagSet = new Set<string>();

  for (const rule of GAZETTEER_RULES) {
    if (rule.patterns.some((re) => re.test(cleaned))) {
      regionSet.add(rule.regionLabel);
      for (const cc of rule.countryCodes) codeSet.add(cc);
      for (const tg of rule.regionalTags) tagSet.add(tg);
    }
  }

  // Also check exact country names from COUNTRY_GEO_INFO (if >= 4 chars so short codes don't false-trigger)
  const lower = cleaned.toLowerCase();
  for (const [code, info] of Object.entries(COUNTRY_GEO_INFO)) {
    const cname = info.name.toLowerCase();
    if (cname.length >= 4 && new RegExp(`\\b${cname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(lower)) {
      codeSet.add(code);
      regionSet.add(info.name);
    }
  }

  return {
    countryCodes: [...codeSet],
    regionLabels: [...regionSet],
    regionalTags: [...tagSet],
    hasGeoIntent: codeSet.size > 0,
  };
}

/** Curated regional quotas for scripts/build-ai-seed.ts to ensure global balance. */
export const REGIONAL_SEED_COUNTRY_GROUPS: Array<{
  region: string;
  perCountryLimit: number;
  countries: string[];
}> = [
  {
    region: 'Sub-Saharan Africa',
    perCountryLimit: 30,
    countries: [
      'ZA', 'KE', 'NG', 'GH', 'TZ', 'ET', 'SN', 'UG', 'CM', 'CI',
      'BW', 'NA', 'ZM', 'ZW', 'RW', 'MZ', 'MW', 'MG', 'MU', 'CD',
      'BJ', 'TG', 'ML', 'BF', 'AO', 'GA', 'CV',
    ],
  },
  {
    region: 'North Africa & Middle East',
    perCountryLimit: 25,
    countries: ['MA', 'EG', 'TN', 'DZ', 'LB', 'AE', 'JO', 'SA', 'TR', 'IL', 'QA', 'OM'],
  },
  {
    region: 'South America',
    perCountryLimit: 40,
    countries: ['BR', 'AR', 'CO', 'PE', 'CL', 'EC', 'BO', 'VE', 'UY', 'PY', 'GY', 'SR'],
  },
  {
    region: 'Central America & Caribbean',
    perCountryLimit: 20,
    countries: ['MX', 'JM', 'CU', 'PR', 'DO', 'CR', 'PA', 'TT', 'GT', 'HT', 'BB'],
  },
  {
    region: 'Asia',
    perCountryLimit: 35,
    countries: ['JP', 'IN', 'KR', 'ID', 'TH', 'VN', 'PH', 'MY', 'TW', 'HK', 'SG', 'CN', 'PK', 'NP', 'LK', 'KZ'],
  },
  {
    region: 'Oceania',
    perCountryLimit: 35,
    countries: ['AU', 'NZ', 'FJ', 'PG'],
  },
  {
    region: 'Europe (Regional Breadth)',
    perCountryLimit: 30,
    countries: ['IS', 'NO', 'SE', 'FI', 'DK', 'IE', 'PT', 'ES', 'GR', 'IT', 'FR', 'GB', 'DE', 'CH', 'NL', 'PL', 'RO', 'RS', 'HR', 'UA', 'EE'],
  },
  {
    region: 'North America',
    perCountryLimit: 60,
    countries: ['US', 'CA'],
  },
];

export const CULTURAL_SEED_TAGS = [
  'jazz', 'ambient', 'classical', 'chillout', 'lofi', 'electronic',
  'rock', 'indie', 'soul', 'blues', 'folk', 'world music',
  'latin', 'reggae', 'news', 'talk', 'soundtrack', 'piano',
  'african', 'african music', 'afrobeat', 'afrobeats', 'highlife',
  'mpb', 'samba', 'bossa nova', 'cumbia', 'tango', 'salsa',
  'arabic', 'fado', 'flamenco', 'celtic', 'bollywood', 'ethio-jazz',
];
