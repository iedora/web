/**
 * Public API of the menu-publishing slice.
 *
 * The renderer + templates live under `@/features/menu-publishing/rsc/...`
 * and are imported directly by the public page and the theme preview — kept
 * off this barrel so consumers only pull in what they need.
 */
export {
  loadRestaurantSnapshot,
  type RestaurantSnapshot,
} from './use-cases/load-restaurant-snapshot'
export {
  loadRestaurantAdminMenus,
  type AdminMenusSnapshot,
} from './use-cases/load-restaurant-admin-menus'
export {
  loadMenuTree,
  localizeTree,
  type RawCategory,
  type RawItem,
  type RawMenu,
} from './use-cases/load-tree'
export {
  SAMPLE_MENU,
  SAMPLE_MENU_NAME,
  buildI18n,
  pickDefault,
} from './use-cases/sample-data'
export { restaurantTag, revalidateRestaurant } from './cache'
