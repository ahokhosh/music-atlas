// Music Atlas — complete ISO 3166-1 country dataset (shared by client & server)
export type Region = 'Africa' | 'Americas' | 'Asia' | 'Europe' | 'Oceania'

type Entry = [code: string, name: string, region: Region]

const RAW: Entry[] = [
  ['AD','Andorra','Europe'],['AE','United Arab Emirates','Asia'],['AF','Afghanistan','Asia'],
  ['AG','Antigua & Barbuda','Americas'],['AI','Anguilla','Americas'],['AL','Albania','Europe'],
  ['AM','Armenia','Asia'],['AO','Angola','Africa'],['AQ','Antarctica','Oceania'],
  ['AR','Argentina','Americas'],['AS','American Samoa','Oceania'],['AT','Austria','Europe'],
  ['AU','Australia','Oceania'],['AW','Aruba','Americas'],['AX','Åland Islands','Europe'],
  ['AZ','Azerbaijan','Asia'],
  ['BA','Bosnia & Herzegovina','Europe'],['BB','Barbados','Americas'],['BD','Bangladesh','Asia'],
  ['BE','Belgium','Europe'],['BF','Burkina Faso','Africa'],['BG','Bulgaria','Europe'],
  ['BH','Bahrain','Asia'],['BI','Burundi','Africa'],['BJ','Benin','Africa'],
  ['BL','St. Barthélemy','Americas'],['BM','Bermuda','Americas'],['BN','Brunei','Asia'],
  ['BO','Bolivia','Americas'],['BQ','Caribbean Netherlands','Americas'],['BR','Brazil','Americas'],
  ['BS','Bahamas','Americas'],['BT','Bhutan','Asia'],['BV','Bouvet Island','Oceania'],
  ['BW','Botswana','Africa'],['BY','Belarus','Europe'],['BZ','Belize','Americas'],
  ['CA','Canada','Americas'],['CC','Cocos Islands','Oceania'],['CD','DR Congo','Africa'],
  ['CF','Central African Rep.','Africa'],['CG','Congo','Africa'],['CH','Switzerland','Europe'],
  ['CI','Côte d’Ivoire','Africa'],['CK','Cook Islands','Oceania'],['CL','Chile','Americas'],
  ['CM','Cameroon','Africa'],['CN','China','Asia'],['CO','Colombia','Americas'],
  ['CR','Costa Rica','Americas'],['CU','Cuba','Americas'],['CV','Cabo Verde','Africa'],
  ['CW','Curaçao','Americas'],['CX','Christmas Island','Oceania'],['CY','Cyprus','Asia'],
  ['CZ','Czechia','Europe'],
  ['DE','Germany','Europe'],['DJ','Djibouti','Africa'],['DK','Denmark','Europe'],
  ['DM','Dominica','Americas'],['DO','Dominican Republic','Americas'],['DZ','Algeria','Africa'],
  ['EC','Ecuador','Americas'],['EE','Estonia','Europe'],['EG','Egypt','Africa'],
  ['EH','Western Sahara','Africa'],['ER','Eritrea','Africa'],['ES','Spain','Europe'],
  ['ET','Ethiopia','Africa'],
  ['FI','Finland','Europe'],['FJ','Fiji','Oceania'],['FK','Falkland Islands','Americas'],
  ['FM','Micronesia','Oceania'],['FO','Faroe Islands','Europe'],['FR','France','Europe'],
  ['GA','Gabon','Africa'],['GB','United Kingdom','Europe'],['GD','Grenada','Americas'],
  ['GE','Georgia','Asia'],['GF','French Guiana','Americas'],['GG','Guernsey','Europe'],
  ['GH','Ghana','Africa'],['GI','Gibraltar','Europe'],['GL','Greenland','Americas'],
  ['GM','Gambia','Africa'],['GN','Guinea','Africa'],['GP','Guadeloupe','Americas'],
  ['GQ','Equatorial Guinea','Africa'],['GR','Greece','Europe'],['GS','South Georgia','Oceania'],
  ['GT','Guatemala','Americas'],['GU','Guam','Oceania'],['GW','Guinea-Bissau','Africa'],
  ['GY','Guyana','Americas'],
  ['HK','Hong Kong','Asia'],['HM','Heard & McDonald Is.','Oceania'],['HN','Honduras','Americas'],
  ['HR','Croatia','Europe'],['HT','Haiti','Americas'],['HU','Hungary','Europe'],
  ['ID','Indonesia','Asia'],['IE','Ireland','Europe'],['IL','Israel','Asia'],
  ['IM','Isle of Man','Europe'],['IN','India','Asia'],['IO','British Indian Ocean Ter.','Oceania'],
  ['IQ','Iraq','Asia'],['IR','Iran','Asia'],['IS','Iceland','Europe'],['IT','Italy','Europe'],
  ['JE','Jersey','Europe'],['JM','Jamaica','Americas'],['JO','Jordan','Asia'],['JP','Japan','Asia'],
  ['KE','Kenya','Africa'],['KG','Kyrgyzstan','Asia'],['KH','Cambodia','Asia'],
  ['KI','Kiribati','Oceania'],['KM','Comoros','Africa'],['KN','St. Kitts & Nevis','Americas'],
  ['KP','North Korea','Asia'],['KR','South Korea','Asia'],['KW','Kuwait','Asia'],
  ['KY','Cayman Islands','Americas'],['KZ','Kazakhstan','Asia'],
  ['LA','Laos','Asia'],['LB','Lebanon','Asia'],['LC','St. Lucia','Americas'],
  ['LI','Liechtenstein','Europe'],['LK','Sri Lanka','Asia'],['LR','Liberia','Africa'],
  ['LS','Lesotho','Africa'],['LT','Lithuania','Europe'],['LU','Luxembourg','Europe'],
  ['LV','Latvia','Europe'],['LY','Libya','Africa'],
]

const RAW2: Entry[] = [
  ['MA','Morocco','Africa'],['MC','Monaco','Europe'],['MD','Moldova','Europe'],
  ['ME','Montenegro','Europe'],['MF','St. Martin','Americas'],['MG','Madagascar','Africa'],
  ['MH','Marshall Islands','Oceania'],['MK','North Macedonia','Europe'],['ML','Mali','Africa'],
  ['MM','Myanmar','Asia'],['MN','Mongolia','Asia'],['MO','Macao','Asia'],
  ['MP','N. Mariana Islands','Oceania'],['MQ','Martinique','Americas'],['MR','Mauritania','Africa'],
  ['MS','Montserrat','Americas'],['MT','Malta','Europe'],['MU','Mauritius','Africa'],
  ['MV','Maldives','Asia'],['MW','Malawi','Africa'],['MX','Mexico','Americas'],
  ['MY','Malaysia','Asia'],['MZ','Mozambique','Africa'],
  ['NA','Namibia','Africa'],['NC','New Caledonia','Oceania'],['NE','Niger','Africa'],
  ['NF','Norfolk Island','Oceania'],['NG','Nigeria','Africa'],['NI','Nicaragua','Americas'],
  ['NL','Netherlands','Europe'],['NO','Norway','Europe'],['NP','Nepal','Asia'],
  ['NR','Nauru','Oceania'],['NU','Niue','Oceania'],['NZ','New Zealand','Oceania'],
  ['OM','Oman','Asia'],
  ['PA','Panama','Americas'],['PE','Peru','Americas'],['PF','French Polynesia','Oceania'],
  ['PG','Papua New Guinea','Oceania'],['PH','Philippines','Asia'],['PK','Pakistan','Asia'],
  ['PL','Poland','Europe'],['PM','St. Pierre & Miquelon','Americas'],['PN','Pitcairn','Oceania'],
  ['PR','Puerto Rico','Americas'],['PS','Palestine','Asia'],['PT','Portugal','Europe'],
  ['PW','Palau','Oceania'],['PY','Paraguay','Americas'],
  ['QA','Qatar','Asia'],
  ['RE','Réunion','Africa'],['RO','Romania','Europe'],['RS','Serbia','Europe'],
  ['RU','Russia','Europe'],['RW','Rwanda','Africa'],
  ['SA','Saudi Arabia','Asia'],['SB','Solomon Islands','Oceania'],['SC','Seychelles','Africa'],
  ['SD','Sudan','Africa'],['SE','Sweden','Europe'],['SG','Singapore','Asia'],
  ['SH','St. Helena','Africa'],['SI','Slovenia','Europe'],['SJ','Svalbard & Jan Mayen','Europe'],
  ['SK','Slovakia','Europe'],['SL','Sierra Leone','Africa'],['SM','San Marino','Europe'],
  ['SN','Senegal','Africa'],['SO','Somalia','Africa'],['SR','Suriname','Americas'],
  ['SS','South Sudan','Africa'],['ST','São Tomé & Príncipe','Africa'],['SV','El Salvador','Americas'],
  ['SX','Sint Maarten','Americas'],['SY','Syria','Asia'],['SZ','Eswatini','Africa'],
  ['TC','Turks & Caicos','Americas'],['TD','Chad','Africa'],['TF','Fr. Southern Territories','Oceania'],
  ['TG','Togo','Africa'],['TH','Thailand','Asia'],['TJ','Tajikistan','Asia'],
  ['TK','Tokelau','Oceania'],['TL','Timor-Leste','Asia'],['TM','Turkmenistan','Asia'],
  ['TN','Tunisia','Africa'],['TO','Tonga','Oceania'],['TR','Türkiye','Asia'],
  ['TT','Trinidad & Tobago','Americas'],['TV','Tuvalu','Oceania'],['TW','Taiwan','Asia'],
  ['TZ','Tanzania','Africa'],
  ['UA','Ukraine','Europe'],['UG','Uganda','Africa'],['UM','U.S. Outlying Islands','Oceania'],
  ['US','United States','Americas'],['UY','Uruguay','Americas'],['UZ','Uzbekistan','Asia'],
  ['VA','Vatican City','Europe'],['VC','St. Vincent & Grenadines','Americas'],
  ['VE','Venezuela','Americas'],['VG','British Virgin Islands','Americas'],
  ['VI','U.S. Virgin Islands','Americas'],['VN','Vietnam','Asia'],['VU','Vanuatu','Oceania'],
  ['WF','Wallis & Futuna','Oceania'],['WS','Samoa','Oceania'],
  ['YE','Yemen','Asia'],['YT','Mayotte','Africa'],
  ['ZA','South Africa','Africa'],['ZM','Zambia','Africa'],['ZW','Zimbabwe','Africa'],
]

export interface Country {
  code: string
  name: string
  region: Region
  flag: string
  hue: number
}

export function flagOf(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return '🌐'
  return String.fromCodePoint(
    ...code.toUpperCase().split('').map((c) => 127397 + c.charCodeAt(0))
  )
}

function hueOf(code: string): number {
  let h = 0
  for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) % 360
  return h
}

export const REGIONS: Region[] = ['Africa', 'Americas', 'Asia', 'Europe', 'Oceania']

export const COUNTRIES: Country[] = [...RAW, ...RAW2]
  .sort((a, b) => a[1].localeCompare(b[1]))
  .map(([code, name, region]) => ({ code, name, region, flag: flagOf(code), hue: hueOf(code) }))

export const COUNTRY_MAP: Record<string, Country> = Object.fromEntries(
  COUNTRIES.map((c) => [c.code, c])
)

/** Primary local language per country (ISO 639-1) — used to derive the
 *  native-language search query for per-country music discovery
 *  (e.g. IR → fa → ایران, JP → ja → 日本). One language per country keeps
 *  the query fan-out bounded; the most music-relevant one is picked for
 *  multilingual countries. */
export const COUNTRY_LANGS: Record<string, string> = {
  AD: 'ca', AE: 'ar', AF: 'fa', AG: 'en', AI: 'en', AL: 'sq', AM: 'hy', AO: 'pt',
  AQ: 'en', AR: 'es', AS: 'sm', AT: 'de', AU: 'en', AW: 'nl', AX: 'sv', AZ: 'az',
  BA: 'bs', BB: 'en', BD: 'bn', BE: 'nl', BF: 'fr', BG: 'bg', BH: 'ar', BI: 'fr',
  BJ: 'fr', BL: 'fr', BM: 'en', BN: 'ms', BO: 'es', BQ: 'nl', BR: 'pt', BS: 'en',
  BT: 'dz', BV: 'no', BW: 'en', BY: 'be', BZ: 'en', CA: 'en', CC: 'en', CD: 'fr',
  CF: 'fr', CG: 'fr', CH: 'de', CI: 'fr', CK: 'en', CL: 'es', CM: 'fr', CN: 'zh',
  CO: 'es', CR: 'es', CU: 'es', CV: 'pt', CW: 'nl', CX: 'en', CY: 'el', CZ: 'cs',
  DE: 'de', DJ: 'fr', DK: 'da', DM: 'en', DO: 'es', DZ: 'ar', EC: 'es', EE: 'et',
  EG: 'ar', EH: 'ar', ER: 'ti', ES: 'es', ET: 'am', FI: 'fi', FJ: 'fj', FK: 'en',
  FM: 'en', FO: 'fo', FR: 'fr', GA: 'fr', GB: 'en', GD: 'en', GE: 'ka', GF: 'fr',
  GG: 'en', GH: 'en', GI: 'en', GL: 'kl', GM: 'en', GN: 'fr', GP: 'fr', GQ: 'es',
  GR: 'el', GS: 'en', GT: 'es', GU: 'en', GW: 'pt', GY: 'en', HK: 'zh', HM: 'en',
  HN: 'es', HR: 'hr', HT: 'fr', HU: 'hu', ID: 'id', IE: 'ga', IL: 'he', IM: 'en',
  IN: 'hi', IO: 'en', IQ: 'ar', IR: 'fa', IS: 'is', IT: 'it', JE: 'en', JM: 'en',
  JO: 'ar', JP: 'ja', KE: 'sw', KG: 'ky', KH: 'km', KI: 'en', KM: 'ar', KN: 'en',
  KP: 'ko', KR: 'ko', KW: 'ar', KY: 'en', KZ: 'kk', LA: 'lo', LB: 'ar', LC: 'en',
  LI: 'de', LK: 'si', LR: 'en', LS: 'st', LT: 'lt', LU: 'lb', LV: 'lv', LY: 'ar',
  MA: 'ar', MC: 'fr', MD: 'ro', ME: 'sr', MF: 'fr', MG: 'mg', MH: 'en', MK: 'mk',
  ML: 'fr', MM: 'my', MN: 'mn', MO: 'zh', MP: 'en', MQ: 'fr', MR: 'ar', MS: 'en',
  MT: 'mt', MU: 'fr', MV: 'dv', MW: 'ny', MX: 'es', MY: 'ms', MZ: 'pt', NA: 'en',
  NC: 'fr', NE: 'fr', NF: 'en', NG: 'en', NI: 'es', NL: 'nl', NO: 'nb', NP: 'ne',
  NR: 'en', NU: 'en', NZ: 'mi', OM: 'ar', PA: 'es', PE: 'es', PF: 'fr', PG: 'en',
  PH: 'fil', PK: 'ur', PL: 'pl', PM: 'fr', PN: 'en', PR: 'es', PS: 'ar', PT: 'pt',
  PW: 'en', PY: 'es', QA: 'ar', RE: 'fr', RO: 'ro', RS: 'sr', RU: 'ru', RW: 'rw',
  SA: 'ar', SB: 'en', SC: 'fr', SD: 'ar', SE: 'sv', SG: 'en', SH: 'en', SI: 'sl',
  SJ: 'no', SK: 'sk', SL: 'en', SM: 'it', SN: 'fr', SO: 'so', SR: 'nl', SS: 'en',
  ST: 'pt', SV: 'es', SX: 'nl', SY: 'ar', SZ: 'ss', TC: 'en', TD: 'fr', TF: 'fr',
  TG: 'fr', TH: 'th', TJ: 'tg', TK: 'en', TL: 'pt', TM: 'tk', TN: 'ar', TO: 'to',
  TR: 'tr', TT: 'en', TV: 'en', TW: 'zh', TZ: 'sw', UA: 'uk', UG: 'sw', UM: 'en',
  US: 'en', UY: 'es', UZ: 'uz', VA: 'it', VC: 'en', VE: 'es', VG: 'en', VI: 'en',
  VN: 'vi', VU: 'bi', WF: 'fr', WS: 'sm', YE: 'ar', YT: 'fr', ZA: 'zu', ZM: 'en',
  ZW: 'sn',
}

/** The country's own name in its own language (e.g. 'ایران', '日本',
 *  'Deutschland'), derived via Intl at runtime so no translated dataset
 *  has to be maintained. Returns null when the language is unsupported or
 *  the native name adds nothing. Server- and browser-safe. */
export function nativeCountryName(code?: string | null): string | null {
  const cc = code ? code.toUpperCase() : ''
  const lang = cc ? COUNTRY_LANGS[cc] : undefined
  if (!cc || !lang) return null
  try {
    const name = new Intl.DisplayNames([lang], { type: 'region' }).of(cc)
    if (!name || name === cc) return null
    return name
  } catch {
    return null
  }
}

export function getCountry(code?: string | null): Country | null {
  return code ? COUNTRY_MAP[code.toUpperCase()] || null : null
}

/** Countries whose live charts exist upstream; the rest gracefully fall back to global. */
export const GLOBAL_FALLBACK_CODES = new Set(['AQ', 'BV', 'HM', 'IO', 'TF', 'UM', 'GS', 'PN', 'KP'])

