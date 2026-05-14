/**
 * Sanctions and watchlist reference data.
 *
 * This is a static, curated subset for offline screening. In production,
 * replace or supplement with a live feed:
 *   OFAC SDN    — treasury.gov/resource-center/sanctions/SDN-List (XML/CSV, updated daily)
 *   UN           — un.org/securitycouncil/content/un-sc-consolidated-list
 *   EU           — eeas.europa.eu/topics/sanctions-policy
 *   AMLC         — amlc.gov.ph (Designated Persons and Organizations)
 *
 * Each entry lists a canonical name and known aliases. Matching is token-based
 * (all significant tokens of any listed name must appear in the target text),
 * so aliases catch transliterations and abbreviated forms.
 */

export type WatchlistSource = 'ofac-sdn' | 'un' | 'eu' | 'amlc';
export type EntityType = 'individual' | 'entity';

export type SanctionedEntity = {
  id: string;
  type: EntityType;
  list: WatchlistSource;
  /** Canonical name first, then aliases and transliterations. */
  names: string[];
  /** ISO 3166-1 alpha-2 nationality or registration country, if known. */
  country?: string;
};

// ── OFAC Specially Designated Nationals (SDN) ─────────────────────────────
// Source: OFAC SDN List — treasury.gov (Feb 2025 snapshot, representative subset)
const OFAC_SDN: SanctionedEntity[] = [
  // Iran — IRGC / nuclear proliferation
  {
    id: 'ofac-001',
    type: 'individual',
    list: 'ofac-sdn',
    names: ['Ali Khamenei', 'Sayyid Ali Hosseini Khamenei'],
    country: 'IR',
  },
  {
    id: 'ofac-002',
    type: 'entity',
    list: 'ofac-sdn',
    names: ['Islamic Revolutionary Guard Corps', 'IRGC', 'Sepah Pasdaran'],
    country: 'IR',
  },
  {
    id: 'ofac-003',
    type: 'entity',
    list: 'ofac-sdn',
    names: ['Bank Melli Iran', 'Bank Melli'],
    country: 'IR',
  },
  {
    id: 'ofac-004',
    type: 'entity',
    list: 'ofac-sdn',
    names: ['Mahan Air', 'Mahan Airlines'],
    country: 'IR',
  },
  // North Korea — WMD proliferation / DPRK sanctions
  {
    id: 'ofac-005',
    type: 'entity',
    list: 'ofac-sdn',
    names: ['Lazarus Group', 'Hidden Cobra', 'TEMP.Hermit', 'Zinc'],
    country: 'KP',
  },
  {
    id: 'ofac-006',
    type: 'entity',
    list: 'ofac-sdn',
    names: ['Korea Kwangson Banking Corporation', 'KKBC'],
    country: 'KP',
  },
  {
    id: 'ofac-007',
    type: 'entity',
    list: 'ofac-sdn',
    names: ['Bluenoroff', 'APT38'],
    country: 'KP',
  },
  // Russia — Ukraine-related sanctions
  {
    id: 'ofac-008',
    type: 'individual',
    list: 'ofac-sdn',
    names: ['Yevgeny Prigozhin', 'Evgeniy Viktorovich Prigozhin'],
    country: 'RU',
  },
  {
    id: 'ofac-009',
    type: 'entity',
    list: 'ofac-sdn',
    names: ['Internet Research Agency', 'IRA LLC', 'Mediasintez'],
    country: 'RU',
  },
  // Drug trafficking organisations
  {
    id: 'ofac-010',
    type: 'entity',
    list: 'ofac-sdn',
    names: ['Sinaloa Cartel', 'Guzman Loera Organization'],
    country: 'MX',
  },
  {
    id: 'ofac-011',
    type: 'individual',
    list: 'ofac-sdn',
    names: ['Joaquin Guzman Loera', 'El Chapo', 'Chapo Guzman'],
    country: 'MX',
  },
  {
    id: 'ofac-012',
    type: 'entity',
    list: 'ofac-sdn',
    names: ['Clan del Golfo', 'Los Urabeños', 'Autodefensas Gaitanistas de Colombia'],
    country: 'CO',
  },
  // Myanmar — post-coup military regime
  {
    id: 'ofac-013',
    type: 'individual',
    list: 'ofac-sdn',
    names: ['Min Aung Hlaing'],
    country: 'MM',
  },
  {
    id: 'ofac-014',
    type: 'entity',
    list: 'ofac-sdn',
    names: ['Myanmar Economic Corporation', 'MEC'],
    country: 'MM',
  },
  // Terrorism financing
  {
    id: 'ofac-015',
    type: 'entity',
    list: 'ofac-sdn',
    names: ['Al-Qaeda', 'Al Qaida', 'Al-Qaida', 'Qaeda'],
    country: 'AF',
  },
  {
    id: 'ofac-016',
    type: 'entity',
    list: 'ofac-sdn',
    names: ['Islamic State', 'ISIS', 'ISIL', 'Daesh'],
  },
  {
    id: 'ofac-017',
    type: 'entity',
    list: 'ofac-sdn',
    names: ['Hamas', 'Harakat al-Muqawamah al-Islamiyyah', 'Izz al-Din al-Qassam Brigades'],
  },
  {
    id: 'ofac-018',
    type: 'entity',
    list: 'ofac-sdn',
    names: ['Hezbollah', 'Hizballah', 'Islamic Jihad Organisation'],
    country: 'LB',
  },
];

// ── UN Security Council Consolidated List ─────────────────────────────────
// Source: UN SC Res. 1267 (Al-Qaida) and successor resolutions (representative subset)
const UN_LIST: SanctionedEntity[] = [
  {
    id: 'un-001',
    type: 'individual',
    list: 'un',
    names: ['Ayman al-Zawahiri', 'Ayman Mohammed Rabie al-Zawahiri'],
  },
  {
    id: 'un-002',
    type: 'entity',
    list: 'un',
    names: ['Al-Nusrah Front', 'Jabhat al-Nusrah', 'Hay\'at Tahrir al-Sham'],
    country: 'SY',
  },
  {
    id: 'un-003',
    type: 'entity',
    list: 'un',
    names: ['Abu Sayyaf', 'Al Harakat Al Islamiyya'],
    country: 'PH',
  },
  {
    id: 'un-004',
    type: 'entity',
    list: 'un',
    names: ['Jemaah Islamiyah', 'Jama\'a Islamiyya', 'JI'],
    country: 'ID',
  },
  {
    id: 'un-005',
    type: 'individual',
    list: 'un',
    names: ['Isnilon Hapilon', 'Abu Abdullah', 'Abu Musab'],
    country: 'PH',
  },
  {
    id: 'un-006',
    type: 'entity',
    list: 'un',
    names: ['Bangsamoro Islamic Freedom Fighters', 'BIFF'],
    country: 'PH',
  },
  {
    id: 'un-007',
    type: 'individual',
    list: 'un',
    names: ['Mohammad Khwaja', 'Haji Khwaja', 'Haji Mohammad Ishaq'],
    country: 'AF',
  },
  {
    id: 'un-008',
    type: 'entity',
    list: 'un',
    names: ['Haqqani Network', 'Taliban'],
    country: 'AF',
  },
];

// ── EU Consolidated Sanctions List ────────────────────────────────────────
// Source: EEAS Financial Sanctions Database (representative subset, Feb 2025)
const EU_LIST: SanctionedEntity[] = [
  {
    id: 'eu-001',
    type: 'individual',
    list: 'eu',
    names: ['Vladimir Putin', 'Vladimir Vladimirovich Putin'],
    country: 'RU',
  },
  {
    id: 'eu-002',
    type: 'individual',
    list: 'eu',
    names: ['Sergei Lavrov', 'Sergey Viktorovich Lavrov'],
    country: 'RU',
  },
  {
    id: 'eu-003',
    type: 'entity',
    list: 'eu',
    names: ['Gazprombank', 'GPB'],
    country: 'RU',
  },
  {
    id: 'eu-004',
    type: 'entity',
    list: 'eu',
    names: ['Sberbank', 'Sberbank of Russia', 'Public Joint Stock Company Sberbank of Russia'],
    country: 'RU',
  },
  {
    id: 'eu-005',
    type: 'individual',
    list: 'eu',
    names: ['Alexander Lukashenko', 'Alyaksandr Ryhoravich Lukashenka'],
    country: 'BY',
  },
  {
    id: 'eu-006',
    type: 'entity',
    list: 'eu',
    names: ['Wagner Group', 'PMC Wagner', 'Patriot Media Group'],
    country: 'RU',
  },
];

// ── AMLC Designated Persons and Organizations ─────────────────────────────
// Source: AMLC Resolution No. TF-01 and successor resolutions (Philippines)
// Anti-Terrorism Council Designations — Republic Act 11479
const AMLC_LIST: SanctionedEntity[] = [
  {
    id: 'amlc-001',
    type: 'individual',
    list: 'amlc',
    names: ['Zulkifli Abdhir', 'Marwan', 'Abdul Basit Usman'],
    country: 'PH',
  },
  {
    id: 'amlc-002',
    type: 'entity',
    list: 'amlc',
    names: ['Maute Group', 'Islamic State in Lanao', 'Dawlah Islamiyah'],
    country: 'PH',
  },
  {
    id: 'amlc-003',
    type: 'individual',
    list: 'amlc',
    names: ['Hatib Hajan Sawadjaan', 'Abu Yahya Solaiman'],
    country: 'PH',
  },
  {
    id: 'amlc-004',
    type: 'entity',
    list: 'amlc',
    names: ['Ansar Khalifah Philippines', 'AKP', 'Ansar al-Khilafah Philippines'],
    country: 'PH',
  },
  {
    id: 'amlc-005',
    type: 'individual',
    list: 'amlc',
    names: ['Mundi Sawadjaan', 'Abu Hamzah'],
    country: 'PH',
  },
  {
    id: 'amlc-006',
    type: 'entity',
    list: 'amlc',
    names: ['Rajah Solaiman Movement', 'RSM', 'Rajah Solaiman Islamic Movement'],
    country: 'PH',
  },
];

export const SANCTIONS_LIST: SanctionedEntity[] = [
  ...OFAC_SDN,
  ...UN_LIST,
  ...EU_LIST,
  ...AMLC_LIST,
];
