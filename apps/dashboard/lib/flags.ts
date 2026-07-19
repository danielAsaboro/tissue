const TEAM_ISO2: Record<string, string> = {
  Algeria: "DZ",
  Argentina: "AR",
  Australia: "AU",
  Austria: "AT",
  Belgium: "BE",
  "Bosnia & Herzegovina": "BA",
  Brazil: "BR",
  Canada: "CA",
  "Cape Verde": "CV",
  Colombia: "CO",
  "Congo DR": "CD",
  Croatia: "HR",
  Curacao: "CW",
  "Czech Republic": "CZ",
  Ecuador: "EC",
  Egypt: "EG",
  France: "FR",
  Germany: "DE",
  Ghana: "GH",
  Haiti: "HT",
  Iran: "IR",
  Iraq: "IQ",
  "Ivory Coast": "CI",
  Japan: "JP",
  Jordan: "JO",
  Mexico: "MX",
  Morocco: "MA",
  Netherlands: "NL",
  "New Zealand": "NZ",
  Norway: "NO",
  Panama: "PA",
  Paraguay: "PY",
  Portugal: "PT",
  Qatar: "QA",
  "Saudi Arabia": "SA",
  Senegal: "SN",
  "South Africa": "ZA",
  "South Korea": "KR",
  Spain: "ES",
  Sweden: "SE",
  Switzerland: "CH",
  Tunisia: "TN",
  Turkey: "TR",
  USA: "US",
  Uruguay: "UY",
  Uzbekistan: "UZ",
};

// Unicode has no ISO 3166-1 entry for these — real flags via the tag-sequence subdivision
// form instead (may not render on every platform/font, same as anywhere else on the web).
const SPECIAL_FLAGS: Record<string, string> = {
  England: "\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}",
  Scotland: "\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}",
};

function iso2ToFlagEmoji(iso2: string): string {
  return [...iso2.toUpperCase()].map((letter) => String.fromCodePoint(0x1f1e6 + letter.charCodeAt(0) - 65)).join("");
}

/** Deterministic team-name -> flag emoji for the real national teams in TxODDS' World Cup 2026
 *  schedule metadata. No flag field exists anywhere upstream (checked); this derives the real
 *  flag from the real team name instead of fabricating one. Unknown names render no flag rather
 *  than a guess. */
export function teamFlag(teamName: string): string {
  return SPECIAL_FLAGS[teamName] ?? (TEAM_ISO2[teamName] ? iso2ToFlagEmoji(TEAM_ISO2[teamName]) : "");
}
