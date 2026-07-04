export const TEAM_COLORS: Record<string, string> = {
  red_bull: '#3671C6',
  ferrari: '#E8002D',
  mercedes: '#27F4D2',
  mclaren: '#FF8000',
  aston_martin: '#229971',
  alpine: '#FF87BC',
  williams: '#64C4FF',
  rb: '#6692FF',
  audi: '#C7CDD6',
  cadillac: '#AAB2BD',
  kick_sauber: '#52E252',
  haas: '#B6BABD',
};

export function getTeamColor(constructorId?: string) {
  return TEAM_COLORS[constructorId?.toLowerCase() ?? ''] ?? '#888';
}

export function formatGrandPrixName(name?: string) {
  return name?.replace(' Grand Prix', '').replace('Formula 1 ', '') || '';
}
