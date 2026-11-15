import { ArenaRenderer } from './engine';
import { StarshipScene } from './starship';
import { GalleonScene } from './galleon';
import { VolcanoScene } from './volcano';
import { CyberCityScene } from './cyber-city';

export { ArenaRenderer } from './engine';
export type { ArenaScene, ArenaView, TableSkinInfo } from './engine';

export function createArenaRenderer(): ArenaRenderer {
  return new ArenaRenderer({
    starship: () => new StarshipScene(),
    galleon: () => new GalleonScene(),
    volcano: () => new VolcanoScene(),
    cybercity: () => new CyberCityScene(),
  });
}
