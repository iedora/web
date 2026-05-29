// Iedora Manual — primitives kit.
//
// Component groups are in the order the Manual lists them:
//   §VI.1  Button
//   §VI.2  Badge
//   §VI.3  Card
//   §VI.4  Field · Checkbox · Toggle
//   §VI.5  Table
//   §VI.6  Dialog
//   §VI.7  Toast
//   §VI.8  EmptyState
//   §VI.9  Tabs · Breadcrumb
// Editorial chrome (Wordmark, MetaStrip, Statement, Lintel) sits outside §VI
// but speaks the same vocabulary and ships from this package.

export { Wordmark } from "./components/wordmark";
export {
  LangSwitcher,
  type LangOption,
  type LangSwitcherProps,
} from "./components/lang-switcher";
export { KeyMark } from "./components/key-mark";
export { MetaStrip } from "./components/meta-strip";
export { Statement } from "./components/statement";
export { Lintel } from "./components/lintel";

// Editorial / motion primitives (used by the iedora.com landing page;
// reusable in menu for any scroll-pinned editorial layout).
export { PageProgress } from "./components/page-progress";
export { ScrollHint } from "./components/scroll-hint";
export {
  ScrollPinned,
  ScrollPinnedHead,
  ScrollPinnedStage,
  ScrollPinnedFoot,
} from "./components/scroll-pinned";
export { Phrases, Phrase } from "./components/phrases";
export { HouseSvg } from "./components/house-svg";
export { Timeline, type TimelineMark } from "./components/timeline";
export { Wave } from "./components/wave";
export { RoomsGrid, type RoomCell } from "./components/rooms-grid";
export { Shoji, ShojiReceipt } from "./components/shoji";
export { VisuallyHidden } from "./components/visually-hidden";
export { Separator } from "./components/separator";

// Editorial nav — shared chrome shell used by every product surface
// (menu landing, menu dashboard, house). Slot-based composition so the
// same primitive renders a marketing nav, a product chrome, and a
// minimal brand strip without copy-paste.
export {
  Nav,
  NavBrand,
  NavLinks,
  NavLink,
  NavActions,
  type NavProps,
  type NavBrandProps,
  type NavLinksProps,
  type NavLinkProps,
  type NavActionsProps,
} from "./components/nav";

// Editorial sidebar — vertical chrome with a mobile drawer.
export {
  Sidebar,
  SidebarBrand,
  SidebarLinks,
  SidebarLink,
  SidebarSectionLabel,
  SidebarFooter,
  SidebarTrigger,
  SidebarClose,
  SidebarProvider,
  useSidebar,
} from "./components/sidebar";
export {
  ActiveSidebarLinks,
  type ActiveSidebarItem,
  type ActiveSidebarLinksProps,
} from "./components/active-sidebar-links";

export { Button, type ButtonProps } from "./components/button";
export { Badge } from "./components/badge";
export {
  Card,
  CardIndex,
  CardVisual,
  CardTitle,
  CardDesc,
  CardFoot,
} from "./components/card";
export {
  Field,
  FieldLabel,
  FieldHint,
  FieldInput,
  FieldTextarea,
} from "./components/field";
export {
  Combobox,
  type ComboboxOption,
  type ComboboxProps,
} from "./components/combobox";
export { Checkbox, Toggle } from "./components/check-toggle";
export { Table, Th, Td, TableRowNum } from "./components/table";
export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogPortal,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogHeader,
  DialogFooter,
  DialogBody,
  DialogActions,
} from "./components/dialog";
export { Toast, ToastStack } from "./components/toast";
export { EmptyState } from "./components/empty-state";
export { Tabs, Tab } from "./components/tabs";
export {
  Breadcrumb,
  BreadcrumbLink,
  BreadcrumbHere,
} from "./components/breadcrumb";
export { SectionHeader } from "./components/section-header";
export { Pagination, type PaginationProps } from "./components/pagination";

// Admin stats — snapshot panels (Stat, Histogram, StatsPanel) shared
// across cross-tenant admin surfaces (QR codes, sessions, …).
export {
  Stat,
  Histogram,
  StatsHeader,
  StatsPanel,
  type HistogramEntry,
} from "./components/admin-stats";

// Client-context icons — browser + OS vendor marks used by admin
// histograms and session rows. Individual vendor glyphs stay
// internal; consumers pick the right one by passing a name string.
export { BrowserIcon, OsIcon } from "./components/client-icons";

// Editorial form grid — kept for layouts that want a hairline-bordered
// two-column field grid. New auth-style forms should reach for <Field>.
export {
  Pane,
  PaneGrid,
  PaneLabel,
  EditorialInput,
  EditorialTextarea,
} from "./components/pane";
